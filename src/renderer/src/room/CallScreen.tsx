import HeadphoneOff from 'lucide-solid/icons/headphone-off'
import Headphones from 'lucide-solid/icons/headphones'
import LogOut from 'lucide-solid/icons/log-out'
import Mic from 'lucide-solid/icons/mic'
import MicOff from 'lucide-solid/icons/mic-off'
import { createSignal, For, Match, onCleanup, onMount, Show, Switch, type JSX } from 'solid-js'
import type { JoinResult } from '@shared/room'
import { volumeKey } from '@shared/settings'
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
  const { result, events, name } = props.session
  const [peers, setPeers] = createSignal<Peer[]>(result.peers)
  const [mutedPeers, setMutedPeers] = createSignal<ReadonlySet<string>>(new Set(result.mutedPeers))
  // eslint-disable-next-line solid/reactivity -- the initial choice from the join screen
  const [muted, setMutedSignal] = createSignal(props.session.muted)
  const [deafened, setDeafened] = createSignal(false)
  /** Whether the microphone was on before deafening: undeafening turns it back on. */
  let mutedBeforeDeafen = false
  /** Remembered volumes by name (PLAN #23); loaded from settings. */
  const [volumes, setVolumes] = createSignal<Record<string, number>>({})
  const volumeOfName = (peerName: string): number => volumes()[volumeKey(peerName)] ?? 100
  const volumeOf = (peerId: string): number => {
    const peer = peers().find((p) => p.id === peerId)
    return peer ? volumeOfName(peer.name) : 100
  }
  /** While dragging: the gain follows at once, the setting is saved on release. */
  const previewVolume = (peerName: string, volume: number): void => {
    setVolumes((all) => ({ ...all, [volumeKey(peerName)]: volume }))
  }
  const saveVolume = (peerName: string, volume: number): void => {
    previewVolume(peerName, volume)
    void window.ratatosk.settings.update({ audio: { peerVolumes: { [peerName]: volume } } })
  }
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
      case 'peer-muted':
        setMutedPeers((set) => {
          const next = new Set(set)
          if (event.muted) next.add(event.peerId)
          else next.delete(event.peerId)
          return next
        })
        break
      default:
        break
    }
    callEvents.push(event)
  })

  onMount(() => {
    void window.ratatosk.settings.get().then((settings) => {
      setVolumes((current) => ({ ...settings.audio.peerVolumes, ...current }))
    })
    void (props.startCall ?? startRealCall)({
      routerRtpCapabilities: result.routerRtpCapabilities,
      events: callEvents,
      muted: muted(),
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

  const canSpeak = (): boolean => sound() === 'on'

  const setMuted = (value: boolean): void => {
    setMutedSignal(value)
    void call?.setMuted(value).catch((error: unknown) => {
      console.warn('[call] could not change the microphone:', error)
    })
  }

  /** M: the microphone. Turning it on while deafened brings the sound back too. */
  const toggleMic = (): void => {
    if (!canSpeak()) return
    if (muted()) {
      setDeafened(false)
      setMuted(false)
    } else {
      setMuted(true)
    }
  }

  /** D: the sound. Deafening also mutes; undeafening restores the microphone as it was. */
  const toggleSound = (): void => {
    if (deafened()) {
      setDeafened(false)
      if (canSpeak() && !mutedBeforeDeafen) setMuted(false)
    } else {
      mutedBeforeDeafen = muted()
      setDeafened(true)
      if (canSpeak() && !muted()) setMuted(true)
    }
  }

  // Hotkeys work while the window has focus, but not while typing.
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
    if (isTyping(event.target)) return
    // event.code: the same physical keys on the Russian layout (Ь and В).
    if (event.code === 'KeyM') toggleMic()
    else if (event.code === 'KeyD') toggleSound()
    else return
    event.preventDefault()
  }
  onMount(() => {
    window.addEventListener('keydown', onKeyDown)
    onCleanup(() => {
      window.removeEventListener('keydown', onKeyDown)
    })
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
      <div class="call-body">
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
                  <Show when={person.me ? muted() : mutedPeers().has(person.id)}>
                    <span class="call-tile-muted" role="img" aria-label="Микрофон выключен">
                      <MicOff />
                    </span>
                  </Show>
                </li>
              )
            }}
          </For>
        </ul>
        <aside class="call-side" aria-labelledby="call-side-title">
          <h2 id="call-side-title">В комнате · {everyone().length}</h2>
          <Show when={peers().length > 0} fallback={<p class="call-side-alone">Пока никого нет</p>}>
            <ul class="call-volumes">
              <For each={peers()}>
                {(peer) => (
                  <li class="call-volume">
                    <div class="call-volume-head">
                      <Avatar name={peer.name} size="sm" speaking={speaking().has(peer.id)} />
                      <span class="call-volume-name">{peer.name}</span>
                      <Show
                        when={!mutedPeers().has(peer.id)}
                        fallback={<span class="call-volume-muted">микрофон выкл.</span>}
                      >
                        <span class="call-volume-value">{volumeOfName(peer.name)}%</span>
                      </Show>
                    </div>
                    <input
                      type="range"
                      class="call-volume-slider"
                      min="0"
                      max="200"
                      step="5"
                      value={volumeOfName(peer.name)}
                      aria-label={`Громкость: ${peer.name}`}
                      aria-valuetext={`${volumeOfName(peer.name)} %`}
                      onInput={(e) => {
                        previewVolume(peer.name, e.currentTarget.valueAsNumber)
                      }}
                      onChange={(e) => {
                        saveVolume(peer.name, e.currentTarget.valueAsNumber)
                      }}
                    />
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </aside>
      </div>
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
      <div class="call-controls" role="toolbar" aria-label="Управление звонком">
        <button
          type="button"
          class="call-control"
          classList={{ 'call-control--off': muted() }}
          aria-pressed={muted()}
          aria-label={muted() ? 'Включить микрофон' : 'Выключить микрофон'}
          disabled={!canSpeak()}
          onClick={toggleMic}
        >
          <span class="call-control-icon">{muted() ? <MicOff /> : <Mic />}</span>
          {muted() ? 'Выкл.' : 'Микрофон'}
        </button>
        <button
          type="button"
          class="call-control"
          classList={{ 'call-control--off': deafened() }}
          aria-pressed={deafened()}
          aria-label={deafened() ? 'Включить звук' : 'Выключить звук'}
          onClick={toggleSound}
        >
          <span class="call-control-icon">{deafened() ? <HeadphoneOff /> : <Headphones />}</span>
          {deafened() ? 'Звук выкл.' : 'Звук'}
        </button>
      </div>
      <p class="call-hotkeys">
        <kbd>M</kbd> — микрофон · <kbd>D</kbd> — звук
      </p>
      <RemoteAudio voices={voices()} deafened={deafened()} volumeOf={volumeOf} />
    </main>
  )
}

/** Text fields keep their letters; sliders, checkboxes and buttons let the hotkeys through. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLSelectElement) return true
  return (
    target instanceof HTMLInputElement &&
    !['range', 'checkbox', 'radio', 'button', 'submit', 'reset'].includes(target.type)
  )
}
