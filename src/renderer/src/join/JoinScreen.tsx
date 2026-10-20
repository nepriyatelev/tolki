import ArrowLeft from 'lucide-solid/icons/arrow-left'
import Info from 'lucide-solid/icons/info'
import ChevronDown from 'lucide-solid/icons/chevron-down'
import Lock from 'lucide-solid/icons/lock'
import ShieldAlert from 'lucide-solid/icons/shield-alert'
import ShieldCheck from 'lucide-solid/icons/shield-check'
import {
  createResource,
  createSignal,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
  untrack,
  type JSX,
} from 'solid-js'
import {
  buildInvite,
  inviteAddress,
  inviteErrorMessage,
  type Invite,
  type InviteParseResult,
} from '@shared/invite'
import type { JoinError, RoomPreview } from '@shared/room'
import { Avatar, Button, Card, Input, viewTransition } from '../ui'
import type { ErrorKind } from '../errors/error-content'
import { describeJoinError, errorScreenFor } from './join-errors'
import { MicCheck } from '../audio/MicCheck'
import type { MicrophoneAccess } from '../audio/microphone'
import { collectRoomEvents } from '../room/call'
import { CallScreen, type CallSession } from '../room/CallScreen'
import type { startCall as startRealCall } from '../room/start-call'
import './JoinScreen.css'

/** Set when the screen is opened from the recent rooms list. */
export interface RecentContext {
  id: string
  passwordSaved: boolean
}

export interface JoinScreenProps {
  result: InviteParseResult
  onBack: () => void
  recent?: RecentContext | undefined
  /** Prefills the name field. */
  profileName?: string
  onJoined?: () => void
  /** Errors with their own screen (host offline, room full…). */
  onError?: (error: ErrorKind) => void
  microphone?: MicrophoneAccess
  /** Tests replace the real call (mediasoup needs WebRTC). */
  startCall?: typeof startRealCall
}

const plural = new Intl.PluralRules('ru-RU')

/** Only the number of people, never names (PLAN #17, owner's decision). */
export function peopleText(preview: RoomPreview | undefined): string {
  if (preview === undefined) return 'Проверка комнаты…'
  switch (preview.status) {
    case 'live': {
      const n = preview.room.peerCount
      if (n === 0) return 'Пока никого нет'
      return `В комнате ${n} ${plural.select(n) === 'few' ? 'человека' : 'человек'}`
    }
    case 'offline':
      return 'Организатор сейчас не в сети'
    case 'certificate-changed':
      return 'Не удалось проверить комнату'
  }
}

/** «Вход по ссылке» (mockup 3, PLAN #17). */
export function JoinScreen(props: JoinScreenProps): JSX.Element {
  const back = (): void => {
    props.onBack()
  }
  const invite = (): Invite | undefined => (props.result.ok ? props.result.invite : undefined)
  // A light check before joining: room name, number of people, password needed, certificate.
  const [preview] = createResource(invite, (inv) =>
    // The embedded password is not needed for the check and stays out of it.
    window.tolki.room.preview({
      host: inv.host,
      hostKind: inv.hostKind,
      port: inv.port,
      roomId: inv.roomId,
      fingerprint: inv.fingerprint,
    }),
  )
  const live = () => {
    const p = preview.latest
    return p?.status === 'live' ? p.room : undefined
  }
  const [session, setSession] = createSignal<CallSession | null>(null)
  // The link this participant came by: its password is there only if the organizer put it in.
  const inviteLink = (): string | undefined => {
    const inv = invite()
    return inv ? buildInvite(inv) : undefined
  }

  return (
    <Show
      when={session()}
      fallback={
        <main class="join">
          <Card as="section" class="join-card" aria-labelledby="join-title">
            <Switch>
              <Match when={invite()}>
                {(inv) => (
                  <>
                    <div class="join-heading">
                      <h1 id="join-title">{live()?.name ?? 'Вход по ссылке'}</h1>
                      <p class="join-people">{peopleText(preview.latest)}</p>
                      <Show when={live()?.approval}>
                        <p class="join-people">Вход подтверждает организатор</p>
                      </Show>
                    </div>
                    <TrustNote preview={preview.latest} />
                    {/* The address and the certificate: for those who want them (#110). */}
                    <details class="join-details">
                      <summary>
                        Подробнее о подключении
                        <ChevronDown aria-hidden="true" />
                      </summary>
                      <div class="join-details-body">
                        <p class="join-address">{inviteAddress(inv())}</p>
                        <Show when={preview.latest?.status === 'live'}>
                          <p class="join-trust">
                            <ShieldCheck aria-hidden="true" />
                            Подключение напрямую к организатору · сертификат совпадает со ссылкой
                          </p>
                        </Show>
                      </div>
                    </details>
                    <JoinForm
                      invite={inv()}
                      onBack={back}
                      recent={props.recent}
                      profileName={props.profileName ?? ''}
                      onJoined={(joined) => {
                        // The button becomes the call's bar, the room's name its title (#149).
                        viewTransition(() => setSession(joined))
                        props.onJoined?.()
                      }}
                      onError={(error) => props.onError?.(error)}
                      preview={preview.latest}
                      {...(props.microphone ? { microphone: props.microphone } : {})}
                    />
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
      }
    >
      {(current) => (
        <CallScreen
          session={current()}
          inviteLink={inviteLink()}
          onLeft={() => {
            viewTransition(() => setSession(null))
          }}
          {...(props.startCall ? { startCall: props.startCall } : {})}
        />
      )}
    </Show>
  )
}

/** Only what needs attention: a changed certificate, a room not open yet. All well — nothing. */
function TrustNote(props: { preview: RoomPreview | undefined }): JSX.Element {
  return (
    <Switch>
      <Match when={props.preview?.status === 'certificate-changed'}>
        <p class="join-note join-note--bad" role="alert">
          <ShieldAlert aria-hidden="true" />
          {describeJoinError('certificate-mismatch').text}
        </p>
      </Match>
      <Match when={props.preview?.status === 'offline'}>
        <p class="join-note">
          <Info aria-hidden="true" />
          Возможно, комната ещё не открыта. Войти можно чуть позже.
        </p>
      </Match>
    </Switch>
  )
}

type Status =
  | { kind: 'idle' }
  | { kind: 'joining' }
  /** Entry waits for the organizer's «Впустить» (#42). */
  | { kind: 'waiting' }
  | { kind: 'failed'; error: JoinError }

function JoinForm(props: {
  invite: Invite
  onBack: () => void
  recent: RecentContext | undefined
  profileName: string
  onJoined: (session: CallSession) => void
  onError: (error: ErrorKind) => void
  preview: RoomPreview | undefined
  microphone?: MicrophoneAccess
}): JSX.Element {
  // eslint-disable-next-line solid/reactivity -- the initial value only; the user edits it
  const [name, setName] = createSignal(props.profileName)
  // A saved password is used until the host rejects it; then the field appears.
  // eslint-disable-next-line solid/reactivity -- the initial value only
  const [useSaved, setUseSaved] = createSignal(props.recent?.passwordSaved === true)
  const [password, setPassword] = createSignal('')
  const [micMuted, setMicMuted] = createSignal(false)
  const [nameError, setNameError] = createSignal<string | undefined>(undefined)
  const [status, setStatus] = createSignal<Status>({ kind: 'idle' })
  onMount(() => {
    onCleanup(
      // From IPC, outside any tracking scope.
      window.tolki.room.onWaiting(() => {
        untrack(() => {
          if (status().kind === 'joining') {
            viewTransition(() => setStatus({ kind: 'waiting' }))
          }
        })
      }),
    )
  })
  const roomNeedsPassword = () =>
    props.preview?.status === 'live' ? props.preview.room.hasPassword : true
  const askPassword = () =>
    props.invite.password === undefined && !useSaved() && roomNeedsPassword()
  const passwordNote = () => {
    if (!roomNeedsPassword()) return undefined
    if (props.invite.password !== undefined) return 'Пароль вшит в ссылку'
    return useSaved() ? 'Пароль сохранён' : undefined
  }

  const failure = () => {
    const current = status()
    return current.kind === 'failed' ? describeJoinError(current.error) : undefined
  }

  const submit = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault()
    if (name().trim() === '') {
      setNameError('Нужно имя — его увидят участники')
      return
    }
    setNameError(undefined)
    setStatus({ kind: 'joining' })
    // Subscribe before joining: the host announces who is already talking right after welcome.
    const events = collectRoomEvents()
    const result = await window.tolki.room.join({
      invite: props.invite,
      name: name().trim(),
      ...(askPassword() ? { password: password() } : {}),
      ...(props.recent ? { recentId: props.recent.id } : {}),
    })
    if (!result.ok) events.stop()
    // The user stopped waiting for the organizer: back to the form, nothing to say.
    if (!result.ok && result.error === 'cancelled') {
      setStatus({ kind: 'idle' })
      return
    }
    if (!result.ok && result.error === 'WRONG_PASSWORD') setUseSaved(false)
    const screen = result.ok ? null : errorScreenFor(result.error)
    if (screen) {
      setStatus({ kind: 'idle' })
      props.onError(screen)
      return
    }
    if (!result.ok) {
      setStatus({ kind: 'failed', error: result.error })
      return
    }
    setStatus({ kind: 'idle' })
    props.onJoined({ result, events, name: name().trim(), muted: micMuted() })
  }

  return (
    <Show
      when={status().kind !== 'waiting'}
      fallback={
        // A live wait instead of a grey button (#110); the form comes back on cancel.
        <div class="join-waiting" role="status">
          <span class="join-waiting-avatar">
            <Avatar name={name().trim()} size="xl" />
          </span>
          <p class="join-waiting-title">Запрос отправлен организатору</p>
          <p class="join-waiting-text">Вход откроется, как только организатор впустит.</p>
          <Button size="lg" onClick={() => void window.tolki.room.leave()}>
            Отменить запрос
          </Button>
        </div>
      }
    >
      <form class="join-form" onSubmit={(event) => void submit(event)} novalidate>
        <Input
          label="Имя"
          placeholder="Алексей"
          maxLength={32}
          autocomplete="off"
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
          error={nameError()}
        />
        <Show when={askPassword()}>
          <Input
            label="Пароль комнаты"
            type="password"
            placeholder="Пароль — у организатора"
            maxLength={128}
            value={password()}
            onInput={(e) => setPassword(e.currentTarget.value)}
            error={failure()?.field === 'password' ? failure()?.text : undefined}
          />
        </Show>
        <Show when={passwordNote()}>
          {(note) => (
            <p class="join-password-note">
              <Lock aria-hidden="true" />
              {note()}
            </p>
          )}
        </Show>
        <div class="join-mic">
          <MicCheck
            muted={micMuted()}
            onMutedChange={setMicMuted}
            {...(props.microphone ? { access: props.microphone } : {})}
          />
        </div>
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
            size="lg"
            onClick={() => {
              props.onBack()
            }}
          >
            Отмена
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={
              status().kind === 'joining' || props.preview?.status === 'certificate-changed'
            }
          >
            {status().kind === 'joining' ? 'Подключение…' : 'Войти в комнату'}
          </Button>
        </div>
      </form>
    </Show>
  )
}
