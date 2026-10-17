import ArrowLeft from 'lucide-solid/icons/arrow-left'
import ArrowRight from 'lucide-solid/icons/arrow-right'
import Copy from 'lucide-solid/icons/copy'
import { createResource, createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js'
import { DEFAULT_HOST_PORT, type HostStartFailure, type HostState } from '@shared/host-protocol'
import { Button, Card, Checkbox, IconButton, Input, RadioPillGroup } from '../ui'
import { ErrorScreen } from '../errors/ErrorScreen'
import { NetworkCheckCard } from './NetworkCheckCard'
import { createInviteLink, linkAddress } from './invite-link'
import { generatePassword, generateRoomId } from './password'
import './CreateRoomScreen.css'

export type ScreenMode = 'auto' | 'text' | 'motion'

export function startFailureText(reason: HostStartFailure, port: number): string {
  switch (reason) {
    case 'port-in-use':
      return `Порт ${port} занят другой программой. Выбери другой в «Дополнительно».`
    case 'port-forbidden':
      return `Нет прав на порт ${port}. Выбери другой в «Дополнительно».`
    case 'timeout':
    case 'crashed':
    case 'unknown':
      return 'Не получилось открыть комнату. Попробуй ещё раз.'
  }
}

type Phase = { kind: 'editing'; error?: string } | { kind: 'opening' } | { kind: 'open' }

/** «Новая комната» (mockup 2, PLAN #16). */
export function CreateRoomScreen(props: {
  profileName: string
  onBack: () => void
  onOpened?: () => void
}): JSX.Element {
  const roomId = generateRoomId()
  const [roomName, setRoomName] = createSignal('')
  const [password, setPassword] = createSignal('')
  const [embedPassword, setEmbedPassword] = createSignal(false)
  const [mode, setMode] = createSignal<ScreenMode>('auto')
  const [portText, setPortText] = createSignal(String(DEFAULT_HOST_PORT))
  const [checkedPort, setCheckedPort] = createSignal(DEFAULT_HOST_PORT)
  const [name, setName] = createSignal('')
  const [errors, setErrors] = createSignal<{
    roomName?: string | undefined
    port?: string | undefined
    name?: string | undefined
  }>({})
  const [phase, setPhase] = createSignal<Phase>({ kind: 'editing' })
  const [hostState, setHostState] = createSignal<HostState>({ status: 'stopped' })
  const [copied, setCopied] = createSignal(false)
  // «Нельзя хостить» is shown in place of the form so typed values survive going back.
  const [showHelp, setShowHelp] = createSignal(false)

  const [fingerprint] = createResource(() => window.ratatosk.host.getFingerprint())
  let forceCheck = false
  const [check, { refetch: recheck }] = createResource(checkedPort, (port) =>
    window.ratatosk.network.check({ port, force: forceCheck }),
  )

  onMount(() => {
    void window.ratatosk.host.getState().then(setHostState)
    onCleanup(window.ratatosk.host.onState(setHostState))
  })

  const isOpen = () => phase().kind === 'open'
  const address = () => linkAddress(check.latest, hostState())
  const link = () => {
    const where = address()
    const fp = fingerprint.latest
    if (!where || fp === undefined) return undefined
    return createInviteLink({
      address: where,
      roomId,
      fingerprint: fp,
      password: password(),
      embedPassword: embedPassword(),
    })
  }

  const parsePort = (): number | undefined => {
    const port = Number(portText())
    return /^\d+$/.test(portText()) && port >= 1024 && port <= 65535 ? port : undefined
  }
  const applyPort = (): void => {
    const port = parsePort()
    setErrors((e) => ({
      ...e,
      port: port === undefined ? 'Порт — число от 1024 до 65535' : undefined,
    }))
    if (port !== undefined && port !== checkedPort()) setCheckedPort(port)
  }

  const copy = async (): Promise<void> => {
    const text = link()
    if (text === undefined) return
    await window.ratatosk.app.copyText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const open = async (): Promise<void> => {
    const port = parsePort()
    const who = props.profileName || name().trim()
    const nextErrors = {
      ...(roomName().trim() === ''
        ? { roomName: 'Назови комнату — это название увидят друзья' }
        : {}),
      ...(port === undefined ? { port: 'Порт — число от 1024 до 65535' } : {}),
      ...(who === '' ? { name: 'Введи имя — его увидят остальные' } : {}),
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0 || port === undefined) return

    setPhase({ kind: 'opening' })
    const state = await window.ratatosk.host.start({
      port,
      roomName: roomName().trim(),
      password: password(),
    })
    if (state.status !== 'running') {
      const reason = state.status === 'stopped' ? (state.lastError ?? 'unknown') : 'unknown'
      setPhase({ kind: 'editing', error: startFailureText(reason, port) })
      return
    }
    // The host takes part in their own room like everyone else, over localhost.
    const joined = await window.ratatosk.room.join({
      invite: {
        host: '127.0.0.1',
        hostKind: 'ipv4',
        port,
        roomId,
        fingerprint: state.fingerprint,
      },
      name: who,
      password: password(),
    })
    if (!joined.ok) {
      await window.ratatosk.host.stop()
      setPhase({ kind: 'editing', error: 'Не получилось открыть комнату. Попробуй ещё раз.' })
      return
    }
    setPhase({ kind: 'open' })
    props.onOpened?.()
  }

  const close = async (): Promise<void> => {
    await window.ratatosk.room.leave()
    await window.ratatosk.host.stop()
    setPhase({ kind: 'editing' })
  }

  const cannotHost = () => {
    const result = check.latest
    return result !== undefined && !result.verdict.canHost
      ? {
          kind: 'cannot-host' as const,
          problem: result.verdict.problem,
          port: result.port,
          localAddress: result.localAddress,
        }
      : undefined
  }

  return (
    <Show when={showHelp() ? cannotHost() : undefined} fallback={renderForm()}>
      {(error) => (
        <ErrorScreen
          error={error()}
          actions={
            <Button
              icon={<ArrowLeft />}
              onClick={() => {
                setShowHelp(false)
              }}
            >
              Назад к настройкам комнаты
            </Button>
          }
        />
      )}
    </Show>
  )

  function renderForm(): JSX.Element {
    return (
      <main class="create">
        <div class="create-title">
          <Show when={!isOpen()}>
            <IconButton
              label="Назад"
              icon={<ArrowLeft />}
              onClick={() => {
                props.onBack()
              }}
            />
          </Show>
          <h1>Новая комната</h1>
        </div>

        <div class="create-grid">
          <Card as="section" class="create-form" aria-label="Настройки комнаты">
            <fieldset class="create-fields" disabled={phase().kind !== 'editing'}>
              <Input
                label="Название комнаты"
                placeholder="Вечерний созвон"
                maxLength={64}
                value={roomName()}
                onInput={(e) => setRoomName(e.currentTarget.value)}
                error={errors().roomName}
              />
              <Show when={!props.profileName}>
                <Input
                  label="Твоё имя"
                  placeholder="Алексей"
                  maxLength={32}
                  value={name()}
                  onInput={(e) => setName(e.currentTarget.value)}
                  error={errors().name}
                />
              </Show>
              <div class="create-password">
                <Input
                  label="Пароль"
                  mono
                  placeholder="лиса-маяк-42"
                  maxLength={128}
                  autocomplete="off"
                  spellcheck={false}
                  value={password()}
                  onInput={(e) => setPassword(e.currentTarget.value)}
                  hint="Пустой пароль — войти сможет любой, у кого есть ссылка."
                />
                <Button
                  size="lg"
                  onClick={() => {
                    setPassword(generatePassword())
                  }}
                >
                  Сгенерировать
                </Button>
              </div>
              <Checkbox
                label="Вшить пароль в ссылку"
                description="Удобнее: друзьям не нужно ничего вводить. Безопаснее — отправить пароль отдельно."
                checked={embedPassword()}
                onChange={(e) => setEmbedPassword(e.currentTarget.checked)}
              />
              <RadioPillGroup
                legend="Демонстрация экрана"
                value={mode()}
                onChange={setMode}
                options={[
                  { value: 'auto', label: 'Авто', description: 'Подстраивается под сеть' },
                  { value: 'text', label: 'Чёткий текст', description: 'Код, документы · 15 к/с' },
                  { value: 'motion', label: 'Плавно', description: 'Игры, видео · 60 к/с' },
                ]}
              />
              <details class="create-advanced">
                <summary>Дополнительно</summary>
                <Input
                  label="Порт"
                  mono
                  inputMode="numeric"
                  maxLength={5}
                  value={portText()}
                  onInput={(e) => setPortText(e.currentTarget.value)}
                  onBlur={applyPort}
                  hint="Один номер для TCP и UDP. Если пробрасываешь порт на роутере вручную — укажи его здесь."
                  error={errors().port}
                />
              </details>
            </fieldset>
          </Card>

          <div class="create-side">
            <NetworkCheckCard
              result={check.latest}
              loading={check.loading}
              onRetry={() => {
                forceCheck = true
                void recheck()
              }}
            />

            <Card as="section" padding="md" class="link-card" aria-labelledby="link-card-title">
              <h2 id="link-card-title">Ссылка-приглашение</h2>
              <Show
                when={link()}
                fallback={
                  <>
                    <p class="link-card-muted">
                      {check.loading || fingerprint.loading
                        ? 'Ссылка появится после проверки сети.'
                        : 'Ссылку не из чего собрать: друзья не смогут подключиться к этому компьютеру из интернета.'}
                    </p>
                    <Show when={!check.loading && cannotHost()}>
                      <Button
                        block
                        onClick={() => {
                          setShowHelp(true)
                        }}
                      >
                        Почему и что делать?
                      </Button>
                    </Show>
                  </>
                }
              >
                {(text) => (
                  <>
                    <output class="link-card-link">{text()}</output>
                    <Button icon={<Copy />} block onClick={() => void copy()}>
                      {copied() ? 'Ссылка скопирована' : 'Скопировать ссылку'}
                    </Button>
                    <p class="link-card-muted">Ссылка работает, пока комната открыта у тебя.</p>
                  </>
                )}
              </Show>
            </Card>

            <Show
              when={phase().kind === 'editing' ? (phase() as { error?: string }).error : undefined}
            >
              {(error) => (
                <p class="create-error" role="alert">
                  {error()}
                </p>
              )}
            </Show>

            <Show
              when={isOpen()}
              fallback={
                <Button
                  variant="primary"
                  size="lg"
                  block
                  iconEnd={<ArrowRight />}
                  disabled={phase().kind === 'opening'}
                  onClick={() => void open()}
                >
                  {phase().kind === 'opening' ? 'Открываем…' : 'Открыть комнату'}
                </Button>
              }
            >
              <div class="create-open" role="status">
                <p>
                  {link() !== undefined
                    ? 'Комната открыта. Отправь ссылку друзьям.'
                    : 'Комната открыта, но из интернета к ней пока не подключиться.'}
                </p>
                <Button variant="danger" block onClick={() => void close()}>
                  Закрыть комнату
                </Button>
              </div>
            </Show>
          </div>
        </div>
      </main>
    )
  }
}
