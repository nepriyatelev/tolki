import HeadphoneOff from 'lucide-solid/icons/headphone-off'
import Headphones from 'lucide-solid/icons/headphones'
import LogOut from 'lucide-solid/icons/log-out'
import Mic from 'lucide-solid/icons/mic'
import MicOff from 'lucide-solid/icons/mic-off'
import Settings from 'lucide-solid/icons/settings'
import { createSignal, For, Match, onCleanup, onMount, Switch, type JSX } from 'solid-js'
import type { JoinResult } from '@shared/room'
import { volumeKey } from '@shared/settings'
import type { Peer } from '@shared/signaling'
import { AudioSettingsDialog } from '../audio/AudioSettingsDialog'
import type { MicrophoneAccess } from '../audio/microphone'
import { Button } from '../ui'
import { createEventBuffer, type RemoteAudio as Voice, type RoomEventSource } from './call'
import { ParticipantTile } from './ParticipantTile'
import { RemoteAudio } from './RemoteAudio'
import { startCall as startRealCall, type CallHandle } from './start-call'
import './CallScreen.css'

const plural = new Intl.PluralRules('ru-RU')

/** «1 участник», «3 участника», «5 участников». */
export function peopleCount(n: number): string {
  const word = { one: 'участник', few: 'участника', many: 'участников', other: 'участника' }[
    plural.select(n) as 'one' | 'few' | 'many' | 'other'
  ]
  return `${n} ${word}`
}

export interface CallSession {
  result: Extract<JoinResult, { ok: true }>
  /** Subscribed before joining, so nothing the host said right after welcome is lost. */
  events: RoomEventSource
  /** The user's own name in the room. */
  name: string
  muted: boolean
}

/** How long the speaking frame stays after the last report of someone's voice. */
export const SPEAKING_HOLD_MS = 600

type Sound = 'connecting' | 'on' | 'listen-only' | 'failed'

/** The call (mockup 4): a tile per participant, a frame around whoever is speaking. */
export function CallScreen(props: {
  session: CallSession
  onLeft: () => void
  /** Tests replace the real call (mediasoup needs WebRTC). */
  startCall?: typeof startRealCall
  /** Tests replace devices and the test sound in «Настройки звука». */
  microphone?: MicrophoneAccess
  playTestSound?: (outputDeviceId: string) => Promise<void>
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
  const [settingsOpen, setSettingsOpen] = createSignal(false)
  const [outputDeviceId, setOutputDeviceId] = createSignal('')
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
  // The frame follows the host's reports (every 300 ms) but lingers a little after someone stops:
  // short pauses between words should not make it blink.
  const releaseTimers = new Map<string, ReturnType<typeof setTimeout>>()
  let shown = new Set<string>()
  const show = (next: Set<string>): void => {
    shown = next
    setSpeaking(next)
  }
  const showSpeakers = (peerIds: string[]): void => {
    const now = new Set(peerIds)
    for (const id of now) {
      clearTimeout(releaseTimers.get(id))
      releaseTimers.delete(id)
    }
    const stopped = [...shown].filter((id) => !now.has(id) && !releaseTimers.has(id))
    show(new Set([...shown, ...now]))
    for (const id of stopped) {
      releaseTimers.set(
        id,
        setTimeout(() => {
          releaseTimers.delete(id)
          show(new Set([...shown].filter((p) => p !== id)))
        }, SPEAKING_HOLD_MS),
      )
    }
  }
  onCleanup(() => {
    for (const timer of releaseTimers.values()) clearTimeout(timer)
  })
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
        showSpeakers(event.peerIds)
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
      setOutputDeviceId(settings.audio.outputDeviceId)
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
    if (isTyping(event.target) || settingsOpen()) return
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

  /** Another microphone mid-call: the producer swaps tracks, nobody reconnects (PLAN #24). */
  const switchMicrophone = (deviceId: string): void => {
    void call?.setInputDevice(deviceId).catch((error: unknown) => {
      console.warn('[call] could not switch the microphone:', error)
    })
  }

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
        <span class="call-count">{peopleCount(everyone().length)}</span>
        <Button variant="danger" icon={<LogOut />} onClick={() => void leave()}>
          Выйти
        </Button>
      </header>
      <ul class="call-tiles" aria-label="Участники">
        <For each={everyone()}>
          {(person) => (
            <ParticipantTile
              person={person}
              speaking={speaking().has(person.id)}
              muted={person.me ? muted() : mutedPeers().has(person.id)}
              volume={volumeOfName(person.name)}
              onVolumePreview={(volume) => {
                previewVolume(person.name, volume)
              }}
              onVolumeSave={(volume) => {
                saveVolume(person.name, volume)
              }}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          )}
        </For>
      </ul>
      <footer class="call-footer">
        <p
          class="call-sound"
          role="status"
          classList={{ 'call-sound--failed': sound() === 'failed' }}
        >
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
          <button
            type="button"
            class="call-control"
            aria-haspopup="dialog"
            onClick={() => setSettingsOpen(true)}
          >
            <span class="call-control-icon">
              <Settings />
            </span>
            Настройки
          </button>
        </div>
        <AudioSettingsDialog
          open={settingsOpen()}
          onClose={() => setSettingsOpen(false)}
          onInputChange={switchMicrophone}
          outputDeviceId={outputDeviceId()}
          onOutputChange={setOutputDeviceId}
          {...(props.microphone ? { access: props.microphone } : {})}
          {...(props.playTestSound ? { playTestSound: props.playTestSound } : {})}
        />
        <p class="call-hotkeys">
          <kbd>M</kbd> — микрофон · <kbd>D</kbd> — звук
        </p>
      </footer>
      <RemoteAudio
        voices={voices()}
        deafened={deafened()}
        volumeOf={volumeOf}
        outputDeviceId={outputDeviceId()}
      />
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
