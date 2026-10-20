import ArrowLeft from 'lucide-solid/icons/arrow-left'
import ArrowRight from 'lucide-solid/icons/arrow-right'
import Copy from 'lucide-solid/icons/copy'
import Router from 'lucide-solid/icons/router'
import { createResource, createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js'
import { DEFAULT_HOST_PORT, type HostStartFailure, type HostState } from '@shared/host-protocol'
import { Button, Card, Checkbox, IconButton, Input, RadioPillGroup, viewTransition } from '../ui'
import { ErrorScreen } from '../errors/ErrorScreen'
import { collectRoomEvents } from '../room/call'
import { CallScreen, type CallSession } from '../room/CallScreen'
import type { startCall as startRealCall } from '../room/start-call'
import { SCREEN_MODE_OPTIONS } from '../screen/screen-modes'
import { NetworkCheckCard } from './NetworkCheckCard'
import { createInviteLink, linkAddress } from './invite-link'
import { generatePassword, generateRoomId } from './password'
import './CreateRoomScreen.css'

import type { ScreenMode } from '@shared/screen'

export type { ScreenMode }

export function startFailureText(reason: HostStartFailure, port: number): string {
  switch (reason) {
    case 'port-in-use':
      return `Порт ${port} занят другой программой. Другой порт можно указать в «Дополнительно».`
    case 'port-forbidden':
      return `Нет прав на порт ${port}. Другой порт можно указать в «Дополнительно».`
    case 'timeout':
    case 'crashed':
    case 'unknown':
      return 'Открыть комнату не получилось. Можно попробовать ещё раз.'
  }
}

/** Open: the organizer is in the call of their own room (#100). */
type Phase =
  { kind: 'editing'; error?: string } | { kind: 'opening' } | { kind: 'open'; session: CallSession }

/** «Новая комната» (mockup 2, PLAN #16). */
export function CreateRoomScreen(props: {
  profileName: string
  onBack: () => void
  onOpened?: () => void
  /** Tests replace the real call (mediasoup needs WebRTC). */
  startCall?: typeof startRealCall
}): JSX.Element {
  const roomId = generateRoomId()
  const [roomName, setRoomName] = createSignal('')
  const [password, setPassword] = createSignal('')
  const [embedPassword, setEmbedPassword] = createSignal(false)
  /** Entry waits for the organizer's «Впустить» (#42); can be changed in the call too. */
  const [approval, setApproval] = createSignal(false)
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

  const [fingerprint] = createResource(() => window.tolki.host.getFingerprint())
  let forceCheck = false
  const [check, { refetch: recheck }] = createResource(checkedPort, (port) =>
    window.tolki.network.check({ port, force: forceCheck }),
  )

  /** macOS has not asked for the microphone yet (#85): say so before it does. */
  const [micNotAsked, setMicNotAsked] = createSignal(false)

  onMount(() => {
    void window.tolki.permissions
      .status('microphone')
      .then((state) => setMicNotAsked(state === 'not-asked'))
      .catch(() => undefined)
    void window.tolki.host.getState().then(setHostState)
    onCleanup(window.tolki.host.onState(setHostState))
  })

  const session = () => {
    const current = phase()
    return current.kind === 'open' ? current.session : undefined
  }
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
    await window.tolki.app.copyText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const open = async (): Promise<void> => {
    const port = parsePort()
    const who = props.profileName || name().trim()
    const nextErrors = {
      ...(roomName().trim() === '' ? { roomName: 'Нужно название — его увидят участники' } : {}),
      ...(port === undefined ? { port: 'Порт — число от 1024 до 65535' } : {}),
      ...(who === '' ? { name: 'Нужно имя — его увидят участники' } : {}),
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0 || port === undefined) return

    setPhase({ kind: 'opening' })
    // The system dialog now, not in the middle of the call; a refusal means listening only.
    if (micNotAsked()) {
      await window.tolki.permissions.request('microphone').catch(() => undefined)
      setMicNotAsked(false)
    }
    const state = await window.tolki.host.start({
      port,
      roomName: roomName().trim(),
      password: password(),
      screenMode: mode(),
      approval: approval(),
    })
    if (state.status !== 'running') {
      const reason = state.status === 'stopped' ? (state.lastError ?? 'unknown') : 'unknown'
      setPhase({ kind: 'editing', error: startFailureText(reason, port) })
      return
    }
    // The host takes part in their own room like everyone else, over localhost. Subscribed
    // before joining: the room's first events come right after welcome.
    const events = collectRoomEvents()
    const joined = await window.tolki.room.join({
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
      events.stop()
      await window.tolki.host.stop()
      setPhase({
        kind: 'editing',
        error: 'Открыть комнату не получилось. Можно попробовать ещё раз.',
      })
      return
    }
    viewTransition(() =>
      setPhase({ kind: 'open', session: { result: joined, events, name: who, muted: false } }),
    )
    props.onOpened?.()
  }

  /** The organizer left the call: the room closes for everyone («Организатор закрыл комнату»). */
  const closeRoom = async (): Promise<void> => {
    await window.tolki.host.stop()
    props.onBack()
  }

  const cannotHost = () => {
    const result = check.latest
    return result !== undefined && !result.verdict.canHost
      ? {
          kind: 'cannot-host' as const,
          problem: result.verdict.problem,
          port: result.port,
          localAddress: result.localAddress,
          gateway: result.gateway,
          externalAddress: result.stunAddress,
        }
      : undefined
  }

  return (
    <Show
      when={session()}
      fallback={
        <Show when={showHelp() ? cannotHost() : undefined} fallback={renderForm()}>
          {(error) => (
            <ErrorScreen
              error={error()}
              actions={
                <>
                  <Show when={error().gateway}>
                    <Button
                      variant="primary"
                      icon={<Router />}
                      onClick={() => void window.tolki.network.openRouter()}
                    >
                      Открыть настройки роутера
                    </Button>
                  </Show>
                  <Button
                    icon={<ArrowLeft />}
                    onClick={() => {
                      setShowHelp(false)
                    }}
                  >
                    Назад к настройкам комнаты
                  </Button>
                </>
              }
            />
          )}
        </Show>
      }
    >
      {(current) => (
        <CallScreen
          session={current()}
          inviteLink={link()}
          organizer
          onLeft={() => void closeRoom()}
          {...(props.startCall ? { startCall: props.startCall } : {})}
        />
      )}
    </Show>
  )

  function renderForm(): JSX.Element {
    return (
      <main class="create">
        <div class="create-title">
          <Show when={phase().kind === 'editing'}>
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
                  label="Имя"
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
                description="Удобнее: участникам не нужно ничего вводить. Безопаснее — отправить пароль отдельно."
                checked={embedPassword()}
                onChange={(e) => setEmbedPassword(e.currentTarget.checked)}
              />
              <Checkbox
                label="Подтверждать вход"
                description="Вошедший по ссылке ждёт, пока организатор нажмёт «Впустить». Можно поменять и в звонке."
                checked={approval()}
                onChange={(e) => setApproval(e.currentTarget.checked)}
              />
              <div class="create-screen-mode">
                <RadioPillGroup
                  legend="Демонстрация экрана по умолчанию"
                  value={mode()}
                  onChange={setMode}
                  options={SCREEN_MODE_OPTIONS}
                />
                <p class="create-hint">
                  Тот, кто показывает, может выбрать другое в окне «Что показать». Качество
                  подстраивается под отдачу этого компьютера и число зрителей.
                </p>
              </div>
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
                  hint="Один номер для TCP и UDP. При ручном пробросе порта на роутере — тот же номер."
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
                        : 'Ссылку не из чего собрать: из интернета к этому компьютеру не подключиться.'}
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
                    <p class="link-card-muted">
                      Ссылка работает, пока комната открыта на этом компьютере.
                    </p>
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

            <Show when={micNotAsked()}>
              <p class="create-mic-note">
                macOS спросит доступ к микрофону — он нужен, чтобы участники слышали голос.
              </p>
            </Show>
            <Button
              class="create-open"
              variant="primary"
              size="lg"
              block
              iconEnd={<ArrowRight />}
              disabled={phase().kind === 'opening'}
              onClick={() => void open()}
            >
              {phase().kind === 'opening' ? 'Открытие…' : 'Открыть комнату'}
            </Button>
          </div>
        </div>
      </main>
    )
  }
}
