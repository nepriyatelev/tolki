import ArrowLeft from 'lucide-solid/icons/arrow-left'
import { createSignal, Match, Show, Switch, type JSX } from 'solid-js'
import { inviteErrorMessage, type Invite, type InviteParseResult } from '@shared/invite'
import type { JoinError, JoinResult } from '@shared/room'
import { Button, Card, Input } from '../ui'
import { describeJoinError } from './join-errors'
import './JoinScreen.css'

export function inviteAddress(invite: Invite): string {
  const host = invite.hostKind === 'ipv6' ? `[${invite.host}]` : invite.host
  return `${host}:${invite.port}`
}

/**
 * "Вход по ссылке" opened from an invite link. Shows what the link contains and lets the user
 * enter the room with a name and, if needed, the password (issues #12, #13). The full screen
 * with the microphone check is issue #17.
 */
export function JoinScreen(props: { result: InviteParseResult; onBack: () => void }): JSX.Element {
  const back = (): void => {
    props.onBack()
  }
  return (
    <main class="join">
      <Card as="section" class="join-card" aria-labelledby="join-title">
        <Switch>
          <Match when={props.result.ok ? props.result.invite : undefined}>
            {(invite) => (
              <>
                <h1 id="join-title">Вход по ссылке</h1>
                <dl class="join-details">
                  <dt>Хост</dt>
                  <dd class="join-mono">{inviteAddress(invite())}</dd>
                  <dt>Комната</dt>
                  <dd class="join-mono">{invite().roomId}</dd>
                  <dt>Пароль</dt>
                  <dd>{invite().password !== undefined ? 'вшит в ссылку' : 'спроси у хоста'}</dd>
                  <dt>Сертификат</dt>
                  <dd>
                    <span class="join-mono">{invite().fingerprint.slice(0, 12)}…</span> — сверим при
                    подключении
                  </dd>
                </dl>
                <JoinForm invite={invite()} onBack={back} />
              </>
            )}
          </Match>
          <Match when={!props.result.ok ? props.result.error : undefined}>
            {(error) => (
              <>
                <h1 id="join-title">Не получилось открыть ссылку</h1>
                <p class="join-error">{inviteErrorMessage(error())}</p>
                <Button icon={<ArrowLeft />} onClick={back}>
                  Назад
                </Button>
              </>
            )}
          </Match>
        </Switch>
      </Card>
    </main>
  )
}

type Status =
  | { kind: 'idle' }
  | { kind: 'joining' }
  | { kind: 'joined'; result: Extract<JoinResult, { ok: true }> }
  | { kind: 'failed'; error: JoinError }

function JoinForm(props: { invite: Invite; onBack: () => void }): JSX.Element {
  const [name, setName] = createSignal('')
  const [password, setPassword] = createSignal('')
  const [nameError, setNameError] = createSignal<string | undefined>(undefined)
  const [status, setStatus] = createSignal<Status>({ kind: 'idle' })

  const failure = () => {
    const current = status()
    return current.kind === 'failed' ? describeJoinError(current.error) : undefined
  }
  const joined = () => {
    const current = status()
    return current.kind === 'joined' ? current.result : undefined
  }

  const submit = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault()
    if (name().trim() === '') {
      setNameError('Введи имя — его увидят остальные')
      return
    }
    setNameError(undefined)
    setStatus({ kind: 'joining' })
    const result = await window.ratatosk.room.join({
      invite: props.invite,
      name: name().trim(),
      ...(props.invite.password === undefined ? { password: password() } : {}),
    })
    setStatus(result.ok ? { kind: 'joined', result } : { kind: 'failed', error: result.error })
  }

  const leave = async (): Promise<void> => {
    await window.ratatosk.room.leave()
    setStatus({ kind: 'idle' })
  }

  return (
    <Show
      when={joined()}
      fallback={
        <form class="join-form" onSubmit={(event) => void submit(event)} novalidate>
          <Input
            label="Твоё имя"
            placeholder="Алексей"
            maxLength={32}
            autocomplete="off"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            error={nameError()}
          />
          <Show when={props.invite.password === undefined}>
            <Input
              label="Пароль комнаты"
              type="password"
              placeholder="Спроси у хоста"
              maxLength={128}
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              hint="Оставь пустым, если пароля нет"
              error={failure()?.field === 'password' ? failure()?.text : undefined}
            />
          </Show>
          <Show when={failure()?.field === undefined ? failure()?.text : undefined}>
            {(text) => (
              <p class="join-alert" role="alert">
                {text()}
              </p>
            )}
          </Show>
          <div class="join-actions">
            <Button
              type="button"
              icon={<ArrowLeft />}
              onClick={() => {
                props.onBack()
              }}
            >
              Назад
            </Button>
            <Button type="submit" variant="primary" disabled={status().kind === 'joining'}>
              {status().kind === 'joining' ? 'Подключаемся…' : 'Войти в комнату'}
            </Button>
          </div>
        </form>
      }
    >
      {(result) => (
        <div class="join-joined" role="status">
          <p>
            Ты в комнате «{result().room.name}». Участников вместе с тобой:{' '}
            {result().peers.length + 1}.
          </p>
          <Button variant="danger" onClick={() => void leave()}>
            Выйти
          </Button>
        </div>
      )}
    </Show>
  )
}
