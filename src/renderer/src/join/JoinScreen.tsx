import ArrowLeft from 'lucide-solid/icons/arrow-left'
import Info from 'lucide-solid/icons/info'
import Link from 'lucide-solid/icons/link'
import Lock from 'lucide-solid/icons/lock'
import ShieldAlert from 'lucide-solid/icons/shield-alert'
import ShieldCheck from 'lucide-solid/icons/shield-check'
import { createResource, createSignal, Match, onCleanup, Show, Switch, type JSX } from 'solid-js'
import {
  inviteAddress,
  inviteErrorMessage,
  type Invite,
  type InviteParseResult,
} from '@shared/invite'
import type { JoinError, JoinResult, RoomPreview } from '@shared/room'
import logo from '../assets/logo.svg'
import { Button, Card, Chip, Input } from '../ui'
import type { ErrorKind } from '../errors/error-content'
import { describeJoinError, errorScreenFor } from './join-errors'
import { MicCheck } from './MicCheck'
import type { MicrophoneAccess } from './microphone'
import { collectRoomEvents, type RemoteAudio as Voice } from '../room/call'
import { RemoteAudio } from '../room/RemoteAudio'
import { startCall as startRealCall, type CallHandle } from '../room/start-call'
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
  if (preview === undefined) return 'Проверяем комнату…'
  switch (preview.status) {
    case 'live': {
      const n = preview.room.peerCount
      if (n === 0) return 'Пока никого нет — ты будешь первым'
      return `В комнате ${n} ${plural.select(n) === 'few' ? 'человека' : 'человек'}`
    }
    case 'offline':
      return 'Хост сейчас не в сети'
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
    window.ratatosk.room.preview({
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

  return (
    <main class="join">
      <Card as="section" class="join-card" aria-labelledby="join-title">
        <img class="join-logo" src={logo} alt="" width="48" height="48" />
        <Switch>
          <Match when={invite()}>
            {(inv) => (
              <>
                <Chip icon={<Link />}>Приглашение</Chip>
                <div class="join-heading">
                  <h1 id="join-title">{live()?.name ?? 'Вход по ссылке'}</h1>
                  <p class="join-people">{peopleText(preview.latest)}</p>
                  <p class="join-address">{inviteAddress(inv())}</p>
                </div>
                <TrustNote preview={preview.latest} />
                <JoinForm
                  invite={inv()}
                  onBack={back}
                  recent={props.recent}
                  profileName={props.profileName ?? ''}
                  onJoined={() => props.onJoined?.()}
                  onError={(error) => props.onError?.(error)}
                  preview={preview.latest}
                  {...(props.microphone ? { microphone: props.microphone } : {})}
                  {...(props.startCall ? { startCall: props.startCall } : {})}
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
  )
}

function TrustNote(props: { preview: RoomPreview | undefined }): JSX.Element {
  return (
    <Switch>
      <Match when={props.preview?.status === 'live'}>
        <p class="join-note join-note--ok">
          <ShieldCheck aria-hidden="true" />
          Подключение напрямую к хосту · сертификат совпадает со ссылкой
        </p>
      </Match>
      <Match when={props.preview?.status === 'certificate-changed'}>
        <p class="join-note join-note--bad" role="alert">
          <ShieldAlert aria-hidden="true" />
          {describeJoinError('certificate-mismatch').text}
        </p>
      </Match>
      <Match when={props.preview?.status === 'offline'}>
        <p class="join-note">
          <Info aria-hidden="true" />
          Возможно, комната ещё не открыта. Попробуй войти чуть позже.
        </p>
      </Match>
    </Switch>
  )
}

type Status =
  | { kind: 'idle' }
  | { kind: 'joining' }
  | { kind: 'joined'; result: Extract<JoinResult, { ok: true }> }
  | { kind: 'failed'; error: JoinError }

function JoinForm(props: {
  invite: Invite
  onBack: () => void
  recent: RecentContext | undefined
  profileName: string
  onJoined: () => void
  onError: (error: ErrorKind) => void
  preview: RoomPreview | undefined
  microphone?: MicrophoneAccess
  startCall?: typeof startRealCall
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
  const [voices, setVoices] = createSignal<Voice[]>([])
  const [sound, setSound] = createSignal<'connecting' | 'on' | 'listen-only' | 'failed'>(
    'connecting',
  )
  let call: CallHandle | null = null
  let left = false
  // A function, not the variable: the user may leave while the call is starting.
  const hasLeft = (): boolean => left
  onCleanup(() => {
    left = true
    call?.close()
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
    // Subscribe before joining: the host announces who is already talking right after welcome.
    const events = collectRoomEvents()
    const result = await window.ratatosk.room.join({
      invite: props.invite,
      name: name().trim(),
      ...(askPassword() ? { password: password() } : {}),
      ...(props.recent ? { recentId: props.recent.id } : {}),
    })
    if (!result.ok) events.stop()
    if (!result.ok && result.error === 'WRONG_PASSWORD') setUseSaved(false)
    const screen = result.ok ? null : errorScreenFor(result.error)
    if (screen) {
      setStatus({ kind: 'idle' })
      props.onError(screen)
      return
    }
    setStatus(result.ok ? { kind: 'joined', result } : { kind: 'failed', error: result.error })
    if (!result.ok) return
    props.onJoined()
    left = false
    setSound('connecting')
    try {
      const handle = await (props.startCall ?? startRealCall)({
        routerRtpCapabilities: result.routerRtpCapabilities,
        events,
        muted: micMuted(),
        onRemoteAudio: setVoices,
      })
      if (hasLeft()) {
        handle.close()
        return
      }
      call = handle
      setSound(handle.sending ? 'on' : 'listen-only')
    } catch (error) {
      console.warn('[call] could not start:', error)
      events.stop()
      setSound('failed')
    }
  }

  const leave = async (): Promise<void> => {
    left = true
    call?.close()
    call = null
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
          <Show when={askPassword()}>
            <Input
              label="Пароль комнаты"
              type="password"
              placeholder="Спроси у хоста"
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
            {result().peers.length + 1}.{micMuted() ? ' Микрофон выключен.' : ''}
          </p>
          <Switch>
            <Match when={sound() === 'connecting'}>
              <p class="join-sound">Подключаем звук…</p>
            </Match>
            <Match when={sound() === 'on'}>
              <p class="join-sound">Звук подключён</p>
            </Match>
            <Match when={sound() === 'listen-only'}>
              <p class="join-sound">Микрофон недоступен — ты только слушаешь</p>
            </Match>
            <Match when={sound() === 'failed'}>
              <p class="join-sound join-sound--failed">
                Не получилось подключить звук. Выйди и зайди снова.
              </p>
            </Match>
          </Switch>
          <RemoteAudio voices={voices()} />
          <Button variant="danger" onClick={() => void leave()}>
            Выйти
          </Button>
        </div>
      )}
    </Show>
  )
}
