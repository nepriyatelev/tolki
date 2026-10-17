import LogOut from 'lucide-solid/icons/log-out'
import MicOff from 'lucide-solid/icons/mic-off'
import { createSignal, For, Match, onCleanup, onMount, Show, Switch, type JSX } from 'solid-js'
import type { JoinResult } from '@shared/room'
import type { Peer } from '@shared/signaling'
import { Avatar, Button } from '../ui'
import { createEventBuffer, type RemoteAudio as Voice, type RoomEventSource } from './call'
import { RemoteAudio } from './RemoteAudio'
import { startCall as startRealCall, type CallHandle } from './start-call'
import './CallScreen.css'

export interface CallSession {
  result: Extract<JoinResult, { ok: true }>
  /** Subscribed before joining, so nothing the host said right after welcome is lost. */
  events: RoomEventSource
  /** The user's own name in the room. */
  name: string
  muted: boolean
}

type Sound = 'connecting' | 'on' | 'listen-only' | 'failed'

/** The call (mockup 4): a tile per participant, a frame around whoever is speaking. */
export function CallScreen(props: {
  session: CallSession
  onLeft: () => void
  /** Tests replace the real call (mediasoup needs WebRTC). */
  startCall?: typeof startRealCall
}): JSX.Element {
  // eslint-disable-next-line solid/reactivity -- a session never changes while the screen lives
  const { result, events, name, muted } = props.session
  const [peers, setPeers] = createSignal<Peer[]>(result.peers)
  const [speaking, setSpeaking] = createSignal<ReadonlySet<string>>(new Set())
  const [voices, setVoices] = createSignal<Voice[]>([])
  const [sound, setSound] = createSignal<Sound>('connecting')
  // The call gets its own copy of the events; the screen keeps the list of people.
  const callEvents = createEventBuffer()
  let call: CallHandle | null = null
  let left = false
  // A function, not the variable: the user may leave while the call is starting.
  const hasLeft = (): boolean => left

  events.listen((event) => {
    switch (event.type) {
      case 'peer-joined':
        setPeers((list) => [...list.filter((p) => p.id !== event.peer.id), event.peer])
        break
      case 'peer-left':
        setPeers((list) => list.filter((p) => p.id !== event.peerId))
        break
      case 'active-speakers':
        setSpeaking(new Set(event.peerIds))
        break
      default:
        break
    }
    callEvents.push(event)
  })

  onMount(() => {
    void (props.startCall ?? startRealCall)({
      routerRtpCapabilities: result.routerRtpCapabilities,
      events: callEvents,
      muted,
      onRemoteAudio: setVoices,
    }).then(
      (handle) => {
        if (hasLeft()) {
          handle.close()
          return
        }
        call = handle
        setSound(handle.sending ? 'on' : 'listen-only')
      },
      (error: unknown) => {
        console.warn('[call] could not start:', error)
        setSound('failed')
      },
    )
  })

  const end = (): void => {
    left = true
    call?.close()
    call = null
    events.stop()
  }
  onCleanup(end)

  const leave = async (): Promise<void> => {
    end()
    await window.ratatosk.room.leave()
    props.onLeft()
  }

  const everyone = (): (Peer & { me: boolean })[] => [
    ...peers().map((peer) => ({ ...peer, me: false })),
    { id: result.peerId, name, me: true },
  ]

  return (
    <main class="call">
      <header class="call-header">
        <h1>{result.room.name}</h1>
        <Button variant="danger" icon={<LogOut />} onClick={() => void leave()}>
          Выйти
        </Button>
      </header>
      <ul class="call-tiles" aria-label="Участники">
        <For each={everyone()}>
          {(person) => {
            const isSpeaking = (): boolean => speaking().has(person.id)
            return (
              <li
                class="call-tile"
                classList={{ 'call-tile--speaking': isSpeaking() }}
                data-peer-id={person.id}
                aria-label={`${person.name}${person.me ? ' (ты)' : ''}${isSpeaking() ? ', говорит' : ''}`}
              >
                <Avatar name={person.name} size="xl" speaking={isSpeaking()} />
                <span class="call-tile-name">
                  {person.name}
                  <Show when={person.me}>
                    <span class="call-tile-you">ты</span>
                  </Show>
                </span>
                <Show when={person.me && muted}>
                  <span class="call-tile-muted" role="img" aria-label="Микрофон выключен">
                    <MicOff />
                  </span>
                </Show>
              </li>
            )
          }}
        </For>
      </ul>
      <p class="call-sound" classList={{ 'call-sound--failed': sound() === 'failed' }}>
        <Switch>
          <Match when={sound() === 'connecting'}>Подключаем звук…</Match>
          <Match when={sound() === 'on'}>Звук подключён</Match>
          <Match when={sound() === 'listen-only'}>Микрофон недоступен — ты только слушаешь</Match>
          <Match when={sound() === 'failed'}>
            Не получилось подключить звук. Выйди и зайди снова.
          </Match>
        </Switch>
      </p>
      <RemoteAudio voices={voices()} />
    </main>
  )
}
