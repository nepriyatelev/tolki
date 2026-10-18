import HeadphoneOff from 'lucide-solid/icons/headphone-off'
import Headphones from 'lucide-solid/icons/headphones'
import LogOut from 'lucide-solid/icons/log-out'
import Mic from 'lucide-solid/icons/mic'
import MicOff from 'lucide-solid/icons/mic-off'
import ScreenShare from 'lucide-solid/icons/screen-share'
import ScreenShareOff from 'lucide-solid/icons/screen-share-off'
import Settings from 'lucide-solid/icons/settings'
import UserPlus from 'lucide-solid/icons/user-plus'
import Users from 'lucide-solid/icons/users'
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
  untrack,
  type JSX,
} from 'solid-js'
import type { JoinResult, RoomEvent } from '@shared/room'
import { volumeKey } from '@shared/settings'
import type { Peer } from '@shared/signaling'
import { AudioSettingsDialog } from '../audio/AudioSettingsDialog'
import type { MicrophoneAccess } from '../audio/microphone'
import { ScreenSourceDialog } from '../screen/ScreenSourceDialog'
import { browserScreen, type ScreenAccess } from '../screen/screen-share'
import { Avatar, Button } from '../ui'
import {
  createEventBuffer,
  type RemoteAudio as Voice,
  type RemoteScreen,
  type RoomEventSource,
} from './call'
import { ConnectionIndicator } from './ConnectionIndicator'
import { ParticipantTile } from './ParticipantTile'
import { ScreenStage } from './ScreenStage'
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
  /** Tests replace screen capture. */
  screen?: ScreenAccess
  /** The organizer's invite link, for «Пригласить» (#100); guests get theirs with #80. */
  inviteLink?: string | undefined
  /** The organizer's own app: the room is on this computer, so there is no link to show. */
  organizer?: boolean
}): JSX.Element {
  // eslint-disable-next-line solid/reactivity -- a session never changes while the screen lives
  const { events, name, result: initial } = props.session
  /** The room as joined; after a reconnect (PLAN #31) the state of the new connection. */
  const [joined, setJoined] = createSignal(initial)
  const [reconnecting, setReconnecting] = createSignal(false)
  const [peers, setPeers] = createSignal<Peer[]>(initial.peers)
  const [mutedPeers, setMutedPeers] = createSignal<ReadonlySet<string>>(new Set(initial.mutedPeers))
  // eslint-disable-next-line solid/reactivity -- the initial choice from the join screen
  const [muted, setMutedSignal] = createSignal(props.session.muted)
  const [deafened, setDeafened] = createSignal(false)
  /** Whether the microphone was on before deafening: undeafening turns it back on. */
  let mutedBeforeDeafen = false
  const [settingsOpen, setSettingsOpen] = createSignal(false)
  const [pickerOpen, setPickerOpen] = createSignal(false)
  /** What this user is showing (PLAN #26); sending it to the others comes with #27. */
  const [myScreen, setMyScreen] = createSignal<MediaStream | null>(null)
  const [screenError, setScreenError] = createSignal(false)
  /** One screen at a time (PLAN #29): who shares now, and «Показать свой» in progress. */
  const [sharerId, setSharerId] = createSignal<string | null>(initial.sharerId)
  const [askingToShare, setAskingToShare] = createSignal(false)
  const [linkCopied, setLinkCopied] = createSignal(false)
  const copyInvite = async (link: string): Promise<void> => {
    await window.tolki.app.copyText(link)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }
  const [screenNote, setScreenNote] = createSignal<string | null>(null)
  /** Who asked the user (the sharer) to give way, oldest first. */
  const [screenRequests, setScreenRequests] = createSignal<string[]>([])
  const nameOf = (peerId: string | null): string =>
    peers().find((p) => p.id === peerId)?.name ?? 'Участник'
  const someoneElseShares = (): boolean => {
    const id = sharerId()
    return id !== null && id !== joined().peerId
  }
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
    void window.tolki.settings.update({ audio: { peerVolumes: { [peerName]: volume } } })
  }
  const [speaking, setSpeaking] = createSignal<ReadonlySet<string>>(new Set())
  const [voices, setVoices] = createSignal<Voice[]>([])
  const [screens, setScreens] = createSignal<RemoteScreen[]>([])
  /** With a screen shared the call opens on it (mockup 5); «Все участники» goes back to tiles. */
  const [view, setView] = createSignal<'stage' | 'grid'>('stage')
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
  // The call gets its own copy of the events; the screen keeps the list of people. A new
  // connection after a reconnect gets a new copy.
  let callEvents = createEventBuffer()
  let call: CallHandle | null = null
  let left = false
  // A function, not the variable: the user may leave while the call is starting.
  const hasLeft = (): boolean => left

  // Room events come from IPC, outside any tracking scope; untrack makes that explicit.
  const onRoomEvent = (event: RoomEvent): void => {
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
      case 'screen-share-started':
        setSharerId(event.peerId)
        break
      case 'screen-share-stopped':
        setSharerId((id) => (id === event.peerId ? null : id))
        setScreenRequests([])
        // The screen is free now: whoever asked can pick theirs.
        if (askingToShare()) {
          setAskingToShare(false)
          setPickerOpen(true)
        }
        break
      case 'screen-request':
        setScreenRequests((list) => [
          ...list.filter((id) => id !== event.fromPeerId),
          event.fromPeerId,
        ])
        break
      case 'screen-request-answer':
        if (!askingToShare()) break
        setAskingToShare(false)
        if (event.accepted) setPickerOpen(true)
        else setScreenNote(`${nameOf(sharerId())} продолжает показ`)
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
  }
  events.listen((event) => {
    untrack(() => {
      onRoomEvent(event)
    })
  })

  /** Starts the call for the room as joined; again after a reconnect, with the same choices. */
  const startTheCall = (room: CallSession['result'], buffer: typeof callEvents): void => {
    void (props.startCall ?? startRealCall)({
      routerRtpCapabilities: room.routerRtpCapabilities,
      events: buffer,
      muted: muted(),
      onRemoteAudio: setVoices,
      onRemoteScreens: setScreens,
    }).then(
      (handle) => {
        if (hasLeft() || buffer !== callEvents) {
          handle.close()
          return
        }
        call = handle
        setSound(handle.sending ? 'on' : 'listen-only')
        // Still sharing from before the reconnect: send the same capture again.
        const track = myScreen()?.getVideoTracks()[0]
        if (track) {
          void handle.startScreen(track, room.screenMode).catch((error: unknown) => {
            console.warn('[screen] could not resume after reconnecting:', error)
            stopScreen()
          })
        }
      },
      (error: unknown) => {
        console.warn('[call] could not start:', error)
        setSound('failed')
      },
    )
  }

  /** Back in the room as a new participant: fresh state, fresh media, same microphone choice. */
  const resume = (room: CallSession['result']): void => {
    call?.close()
    call = null
    callEvents = createEventBuffer()
    setJoined(room)
    setPeers(room.peers)
    setMutedPeers(new Set(room.mutedPeers))
    setSharerId(room.sharerId)
    setScreens([])
    setVoices([])
    setScreenRequests([])
    setAskingToShare(false)
    setReconnecting(false)
    setSound('connecting')
    startTheCall(room, callEvents)
  }

  onMount(() => {
    void window.tolki.settings.get().then((settings) => {
      setVolumes((current) => ({ ...settings.audio.peerVolumes, ...current }))
      setOutputDeviceId(settings.audio.outputDeviceId)
    })
    startTheCall(joined(), callEvents)
    onCleanup(
      window.tolki.room.onReconnecting(() => {
        setReconnecting(true)
        // Nothing is heard right now: no one is framed as speaking.
        show(new Set())
      }),
    )
    onCleanup(window.tolki.room.onReconnected(resume))
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
    if (isTyping(event.target) || settingsOpen() || pickerOpen()) return
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

  const stopScreen = (): void => {
    for (const track of myScreen()?.getTracks() ?? []) track.stop()
    setMyScreen(null)
    void call?.stopScreen().catch((error: unknown) => {
      console.warn('[screen] could not stop sending:', error)
    })
  }
  const shareScreen = async (sourceId: string | null): Promise<void> => {
    setPickerOpen(false)
    setScreenError(false)
    try {
      const stream = await (props.screen ?? browserScreen).capture(sourceId)
      stopScreen()
      // The system's own «stop sharing» or a closed window ends it too.
      const track = stream.getVideoTracks()[0]
      track?.addEventListener('ended', () => {
        if (myScreen() === stream) stopScreen()
      })
      setMyScreen(stream)
      // Everyone else gets it in the room's mode (sharp text, smooth motion or auto).
      if (track && call) await call.startScreen(track, joined().screenMode)
    } catch (error) {
      // Someone else started first: the room shows one screen at a time.
      if (error instanceof Error && error.message.includes('SCREEN_BUSY')) {
        stopScreen()
        setScreenNote(`Сейчас показывает ${nameOf(sharerId())}`)
        return
      }
      // Cancelling the system picker is not an error worth showing.
      if (!(error instanceof DOMException && error.name === 'NotAllowedError')) {
        console.warn('[screen] could not start:', error)
        setScreenError(true)
      }
    }
  }

  const screenButton = (): { label: string; text: string } => {
    if (myScreen()) return { label: 'Остановить показ экрана', text: 'Остановить' }
    if (askingToShare()) return { label: 'Ожидание ответа на запрос показа', text: 'Ожидание…' }
    if (someoneElseShares())
      return { label: 'Попросить показать свой экран', text: 'Показать свой' }
    return { label: 'Показать экран', text: 'Экран' }
  }

  /** «Показать свой»: the sharer decides; meanwhile the button waits. */
  const askToShare = async (): Promise<void> => {
    setScreenNote(null)
    setAskingToShare(true)
    try {
      await call?.requestScreen()
    } catch (error) {
      setAskingToShare(false)
      // The sharer stopped in the meantime: just pick a screen.
      if (error instanceof Error && error.message.includes('nobody is sharing')) setPickerOpen(true)
      else console.warn('[screen] could not ask:', error)
    }
  }

  /** The user shares and someone asks to show theirs. */
  const answerRequest = async (fromPeerId: string, accept: boolean): Promise<void> => {
    setScreenRequests((list) => list.filter((id) => id !== fromPeerId))
    await call?.answerScreenRequest(fromPeerId, accept).catch(() => undefined)
    if (accept) stopScreen()
  }

  // One MediaStream per remote screen, so the video keeps playing while names or people change;
  // a new one only when the host switches the screen to its other stream (#34).
  let remoteStreamCache: { track: MediaStreamTrack; stream: MediaStream } | null = null
  const remoteStream = (remote: RemoteScreen): MediaStream => {
    if (remoteStreamCache?.track !== remote.track) {
      remoteStreamCache = { track: remote.track, stream: new MediaStream([remote.track]) }
    }
    return remoteStreamCache.stream
  }

  /** The screen in the room (one at a time, PLAN #29): someone else's or the user's own. */
  const shownScreen = createMemo(
    (): {
      title: string
      name: string
      stream: MediaStream
      consumerId: string | null
    } | null => {
      const remote = screens()[0]
      if (remote) {
        const name = nameOf(remote.peerId)
        return {
          title: `Экран: ${name}`,
          name,
          stream: remoteStream(remote),
          consumerId: remote.consumerId,
        }
      }
      const own = myScreen()
      return own ? { title: 'Мой экран', name, stream: own, consumerId: null } : null
    },
  )
  const stage = () => (view() === 'stage' ? shownScreen() : null)
  // A new share opens on the stage again; people coming and going do not.
  createEffect(
    on(
      () => screens()[0]?.consumerId ?? myScreen(),
      (share) => {
        if (share) setView('stage')
      },
    ),
  )

  const end = (): void => {
    stopScreen()
    left = true
    call?.close()
    call = null
    events.stop()
  }
  onCleanup(end)

  const leave = async (): Promise<void> => {
    end()
    await window.tolki.room.leave()
    props.onLeft()
  }

  const everyone = (): (Peer & { me: boolean })[] => [
    ...peers().map((peer) => ({ ...peer, me: false })),
    { id: joined().peerId, name, me: true },
  ]

  return (
    <main class="call">
      <header class="call-header">
        <h1>{joined().room.name}</h1>
        <span class="call-count">{peopleCount(everyone().length)}</span>
        <Show when={!props.organizer}>
          <ConnectionIndicator
            sample={() => call?.connectionSample() ?? Promise.resolve(null)}
            offline={reconnecting()}
          />
        </Show>
        <Show when={props.inviteLink}>
          {(link) => (
            <Button icon={<UserPlus />} onClick={() => void copyInvite(link())}>
              {linkCopied() ? 'Ссылка скопирована' : 'Пригласить'}
            </Button>
          )}
        </Show>
        <Show when={stage()}>
          <Button
            class="call-header-switch"
            icon={<Users />}
            onClick={() => {
              setView('grid')
            }}
          >
            Все участники
          </Button>
        </Show>
        <Button variant="danger" icon={<LogOut />} onClick={() => void leave()}>
          Выйти
        </Button>
      </header>
      <div class="call-body">
        <Show
          when={stage()}
          fallback={
            <>
              <Show when={shownScreen()}>
                {(shown) => (
                  <div class="call-screen-banner" role="status">
                    <span>{shown().title}</span>
                    <Button
                      variant="primary"
                      onClick={() => {
                        setView('stage')
                      }}
                    >
                      Смотреть
                    </Button>
                  </div>
                )}
              </Show>
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
            </>
          }
        >
          {(shown) => (
            <div class="call-stage">
              <ScreenStage
                title={shown().title}
                name={shown().name}
                stream={shown().stream}
                consumerId={shown().consumerId}
                sample={(consumerId) => call?.screenSample(consumerId) ?? Promise.resolve(null)}
                onVisibleChange={(consumerId, visible) => {
                  void call?.setScreenVisible(consumerId, visible).catch(() => undefined)
                }}
                onLayerChange={(consumerId, layer) => {
                  void call?.setScreenLayer(consumerId, layer).catch(() => undefined)
                }}
              />
              <ul class="call-strip" aria-label="Участники">
                <For each={everyone()}>
                  {(person) => (
                    <li
                      class="call-strip-person"
                      classList={{ 'call-strip-person--speaking': speaking().has(person.id) }}
                    >
                      <Avatar name={person.name} size="sm" />
                      <span class="call-strip-name">{person.name}</span>
                      <Show when={person.me}>
                        <span class="call-tile-you">я</span>
                      </Show>
                      <Show when={person.me ? muted() : mutedPeers().has(person.id)}>
                        <span class="call-tile-muted" role="img" aria-label="Микрофон выключен">
                          <MicOff />
                        </span>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          )}
        </Show>
      </div>
      <footer class="call-footer">
        <Show when={reconnecting()}>
          <p class="call-reconnecting" role="status">
            Переподключение…
          </p>
        </Show>
        <p
          class="call-sound"
          hidden={reconnecting()}
          role="status"
          classList={{ 'call-sound--failed': sound() === 'failed' }}
        >
          <Switch>
            <Match when={sound() === 'connecting'}>Подключение звука…</Match>
            <Match when={sound() === 'on'}>Звук подключён</Match>
            <Match when={sound() === 'listen-only'}>
              Микрофон недоступен — только прослушивание
            </Match>
            <Match when={sound() === 'failed'}>
              Звук не подключился. Поможет повторный вход в комнату.
            </Match>
          </Switch>
        </p>
        <For each={screenRequests().slice(0, 1)}>
          {(fromPeerId) => (
            <div class="call-request" role="alert">
              <span>{nameOf(fromPeerId)} просит показать свой экран</span>
              <Button onClick={() => void answerRequest(fromPeerId, false)}>
                Продолжить показ
              </Button>
              <Button variant="primary" onClick={() => void answerRequest(fromPeerId, true)}>
                Уступить
              </Button>
            </div>
          )}
        </For>
        <Show when={screenNote()}>
          {(note) => (
            <p class="call-sound" role="status">
              {note()}
            </p>
          )}
        </Show>
        <Show when={screenError()}>
          <p class="call-sound call-sound--failed" role="alert">
            Показ экрана не начался. Можно попробовать ещё раз или выбрать другое окно.
          </p>
        </Show>
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
            classList={{ 'call-control--active': myScreen() !== null }}
            aria-pressed={myScreen() !== null}
            aria-label={screenButton().label}
            disabled={askingToShare()}
            onClick={() => {
              if (myScreen()) stopScreen()
              else if (someoneElseShares()) void askToShare()
              else setPickerOpen(true)
            }}
          >
            <span class="call-control-icon">
              {myScreen() ? <ScreenShareOff /> : <ScreenShare />}
            </span>
            {screenButton().text}
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
        <ScreenSourceDialog
          open={pickerOpen()}
          onClose={() => setPickerOpen(false)}
          onPick={(sourceId) => void shareScreen(sourceId)}
          {...(props.screen ? { access: props.screen } : {})}
        />
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
