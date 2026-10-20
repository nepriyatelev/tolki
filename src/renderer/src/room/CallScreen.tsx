import HeadphoneOff from 'lucide-solid/icons/headphone-off'
import Headphones from 'lucide-solid/icons/headphones'
import LogOut from 'lucide-solid/icons/log-out'
import MessageSquare from 'lucide-solid/icons/message-square'
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
import type { HotkeyAction, HotkeyStatus } from '@shared/global-hotkeys'
import {
  DEFAULT_PUSH_TO_TALK_KEY,
  pushToTalkKeyLabel,
  type PushToTalkMode,
} from '@shared/push-to-talk'
import { volumeKey } from '@shared/settings'
import type { ScreenMode } from '@shared/screen'
import type { MediaRequest, Peer } from '@shared/signaling'
import { AudioSettingsDialog } from '../audio/AudioSettingsDialog'
import type { MicrophoneAccess } from '../audio/microphone'
import { ScreenSourceDialog } from '../screen/ScreenSourceDialog'
import { browserScreen, type ScreenAccess } from '../screen/screen-share'
import {
  animateLayout,
  Avatar,
  Button,
  createPresence,
  liquidGlass,
  Tooltip,
  viewTransition,
} from '../ui'
import {
  createEventBuffer,
  type ConnectionSample,
  type RemoteAudio as Voice,
  type RemoteScreen,
  type RoomEventSource,
  type ScreenSample,
} from './call'
import { ChatPanel, type ChatMessage, type ChatSendResult } from './ChatPanel'
import { cueLimiter, playCue as playRealCue, type Cue } from '../audio/cue-sounds'
import { CALL_LOG_INTERVAL_MS, callLogLine } from './call-log'
import {
  hostUploadHint,
  hostUploadText,
  hostUploadWarning,
  type HostStats,
} from './upload-estimate'
import { formatCallTime } from './call-timer'
import { callKeyLabel, callKeyOf, isMac } from './call-keys'
import { ConnectionIndicator } from './ConnectionIndicator'
import { RoomMenu } from './RoomMenu'
import { tileLayout } from './tile-layout'
import { ShortcutsDialog } from './ShortcutsDialog'
import { ParticipantTile } from './ParticipantTile'
import { CHROME_HIDE_MS, ScreenStage } from './ScreenStage'
import { RemoteAudio } from './RemoteAudio'
import { startCall as startRealCall, type CallHandle } from './start-call'
import './CallScreen.css'

const plural = new Intl.PluralRules('ru-RU')

/** px between tiles; matches .call-tiles gap. */
const TILE_GAP = 14

/** The chat keeps the latest messages of the call only, in memory (#45). */
const MAX_CHAT_MESSAGES = 500

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

/** Louder than this (0..1) while muted counts as speaking into a muted microphone (#110). */
export const MUTED_SPEECH_LEVEL = 0.3
/** For this long in a row, the tip «Микрофон выключен» shows, once per call. */
export const MUTED_SPEECH_MS = 800
/** And goes away by itself after this. */
export const MUTED_SPEECH_TIP_MS = 8000

/** The call (mockup 4): a tile per participant, a frame around whoever is speaking. */
export function CallScreen(props: {
  session: CallSession
  onLeft: () => void
  /** Tests replace the real call (mediasoup needs WebRTC). */
  startCall?: typeof startRealCall
  /** Tests replace devices and the test sound in «Настройки». */
  microphone?: MicrophoneAccess
  playTestSound?: (outputDeviceId: string) => Promise<void>
  /** Tests replace screen capture. */
  screen?: ScreenAccess
  /** Tests replace the cues (PLAN #43). */
  playCue?: (cue: Cue, outputDeviceId: string) => Promise<void>
  /**
   * For «Пригласить»: the organizer's link (#100), or the one a participant came by (#80) —
   * with the password only if the organizer put it into the link.
   */
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
  /** Listening only because the OS denies the microphone (#85). */
  const [micDenied, setMicDenied] = createSignal(false)
  /** Whether the microphone was on before deafening: undeafening turns it back on. */
  let mutedBeforeDeafen = false
  const [settingsOpen, setSettingsOpen] = createSignal(false)
  /** The list of keys (#110), by Ctrl+/ (⌘/). */
  const [shortcutsOpen, setShortcutsOpen] = createSignal(false)
  /** Once, in the first call: where the keys are. */
  const [keysHint, setKeysHint] = createSignal(false)
  /** The user's own voice level (0..1), for the ring on the microphone button (#110). */
  const [micLevel, setMicLevel] = createSignal(0)
  /** «Микрофон выключен — вас не слышно»: shown once per call, when they speak muted. */
  const [mutedSpeechTip, setMutedSpeechTip] = createSignal(false)
  let mutedSpeechTipShown = false
  let mutedSpeechSince: number | null = null
  let mutedSpeechTimer: ReturnType<typeof setTimeout> | undefined
  // The one-time tips leave the way they came (#149).
  const mutedTipPresence = createPresence(mutedSpeechTip)
  const keysHintPresence = createPresence(keysHint)
  const mac = isMac()
  const [pickerOpen, setPickerOpen] = createSignal(false)
  /** What this user is showing (PLAN #26); sending it to the others comes with #27. */
  const [myScreen, setMyScreen] = createSignal<MediaStream | null>(null)
  const [screenError, setScreenError] = createSignal(false)
  /** The organizer's upload, as the host reports it (#87). */
  const [hostStats, setHostStats] = createSignal<HostStats | null>(null)
  /** The mode last picked in «Что показать» (#86), remembered; the room's until then. */
  const [pickedMode, setPickedMode] = createSignal<ScreenMode | null>(null)
  const screenMode = (): ScreenMode => pickedMode() ?? joined().screenMode
  /** The mode the user's screen goes out in now: a reconnect resumes it the same. */
  let sharingMode: ScreenMode = 'auto'
  /** One screen at a time (PLAN #29): who shares now, and «Показать свой» in progress. */
  const [sharerId, setSharerId] = createSignal<string | null>(initial.sharerId)
  const [askingToShare, setAskingToShare] = createSignal(false)
  // The organizer's rights (#42): who waits to be let in, whether entry waits at all.
  const [joinRequests, setJoinRequests] = createSignal<{ requestId: string; name: string }[]>([])
  const [approval, setApproval] = createSignal(initial.approval)
  const isOrganizer = (): boolean => joined().organizer
  const organizerRequest = (request: MediaRequest): void => {
    void window.tolki.room.request(request).then((response) => {
      if (!response.ok) console.warn(`[room] ${request.method} failed: ${response.error}`)
    })
  }
  const answerJoin = (requestId: string, admit: boolean): void => {
    // The card leaves instead of vanishing (#149).
    viewTransition(() => setJoinRequests((list) => list.filter((r) => r.requestId !== requestId)))
    organizerRequest({ method: 'answerJoin', requestId, admit })
  }
  const toggleApproval = (): void => {
    const enabled = !approval()
    setApproval(enabled)
    organizerRequest({ method: 'setApproval', enabled })
  }
  const [linkCopied, setLinkCopied] = createSignal(false)
  // The call's numbers in the logs every half a minute (#106): the link, and the screen if any.
  let lastLink: ConnectionSample | null = null
  let lastScreen: { key: string; sample: ScreenSample } | null = null
  const statsLog = setInterval(() => {
    const handle = call
    if (!handle) return
    const own = myScreen() !== null
    const key = own ? 'own' : (screens()[0]?.consumerId ?? null)
    void Promise.all([
      handle.connectionSample(),
      key === null ? Promise.resolve(null) : handle.screenSample(own ? null : key),
    ]).then(([link, screen]) => {
      const before = lastScreen?.key === key ? lastScreen.sample : null
      console.info(
        callLogLine({ now: link, before: lastLink }, screen ? { now: screen, before, own } : null),
      )
      lastLink = link
      lastScreen = screen && key !== null ? { key, sample: screen } : null
    })
  }, CALL_LOG_INTERVAL_MS)
  onCleanup(() => {
    clearInterval(statsLog)
  })
  // Since entering the room; a reconnect (PLAN #31) does not start it over.
  const joinedAt = Date.now()
  const [now, setNow] = createSignal(joinedAt)
  const clock = setInterval(() => setNow(Date.now()), 1000)
  onCleanup(() => {
    clearInterval(clock)
  })
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
  // The mini chat (#45): only what came during this call, nothing saved anywhere.
  const [chatOpen, setChatOpen] = createSignal(false)
  const [chat, setChat] = createSignal<ChatMessage[]>([])
  const [unread, setUnread] = createSignal(0)
  let chatId = 0
  const sendChat = async (text: string): Promise<ChatSendResult> => {
    const response = await window.tolki.room
      .request({ method: 'sendChat', text })
      .catch(() => ({ ok: false as const, error: 'failed' }))
    if (response.ok) return 'sent'
    return response.error === 'too many messages' ? 'too-many' : 'failed'
  }
  const someoneElseShares = (): boolean => {
    const id = sharerId()
    return id !== null && id !== joined().peerId
  }
  const [outputDeviceId, setOutputDeviceId] = createSignal('')
  // Cues (PLAN #43): someone came, left or asks to be let in — not while the sound is off.
  const [soundsOn, setSoundsOn] = createSignal(true)
  // eslint-disable-next-line solid/reactivity -- called from room events; reads the device then
  const playCueNow = cueLimiter((which) => {
    void (props.playCue ?? playRealCue)(which, outputDeviceId()).catch(() => undefined)
  })
  const cue = (which: Cue): void => {
    if (soundsOn() && !deafened()) playCueNow(which)
  }
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
  /** The grid of tiles, for their gliding when people come and go (#149). */
  let tilesList: HTMLUListElement | undefined
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
        // The state now; the tiles glide to their new places after it (#149).
        animateLayout(tilesList, () =>
          setPeers((list) => [...list.filter((p) => p.id !== event.peer.id), event.peer]),
        )
        cue('join')
        break
      case 'peer-left':
        animateLayout(tilesList, () =>
          setPeers((list) => list.filter((p) => p.id !== event.peerId)),
        )
        cue('leave')
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
      // The organizer's side of entry by approval (#42).
      case 'join-request':
        cue('knock')
        setJoinRequests((list) => [
          ...list.filter((r) => r.requestId !== event.requestId),
          { requestId: event.requestId, name: event.name },
        ])
        break
      case 'join-request-gone':
        setJoinRequests((list) => list.filter((r) => r.requestId !== event.requestId))
        break
      case 'approval-changed':
        setApproval(event.enabled)
        break
      case 'screen-request-answer':
        if (!askingToShare()) break
        setAskingToShare(false)
        if (event.accepted) setPickerOpen(true)
        else setScreenNote(`${nameOf(sharerId())} продолжает показ`)
        break
      case 'chat': {
        const me = event.peerId === joined().peerId
        const message = {
          id: ++chatId,
          peerId: event.peerId,
          name: me ? name : nameOf(event.peerId),
          me,
          text: event.text,
          time: Date.now(),
        }
        setChat((list) => [...list.slice(-(MAX_CHAT_MESSAGES - 1)), message])
        if (!chatOpen() && !me) setUnread((n) => n + 1)
        break
      }
      case 'host-stats':
        setHostStats({
          uploadMbps: event.uploadMbps,
          participants: event.participants,
          screen: event.screen,
          measured: event.measured,
        })
        break
      case 'screen-budget':
        // What the organizer's upload carries to everyone watching (#86).
        console.info(`[screen] ceiling from the organizer: ${event.height}p`)
        void call
          ?.setScreenBudget({ height: event.height, maxBitrate: event.maxBitrate })
          .catch((error: unknown) => {
            console.warn('[screen] could not apply the ceiling:', error)
          })
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

  /** The voice level each frame: the ring on the button, and the tip when muted (#110). */
  const onMicLevel = (level: number): void => {
    // Steps of 5 %: the signal changes only when the ring would.
    setMicLevel(Math.round(level * 20) / 20)
    if (mutedSpeechTipShown) return
    const speakingMuted =
      level > MUTED_SPEECH_LEVEL && muted() && !ptt().enabled && !deafened() && canSpeak()
    if (!speakingMuted) {
      mutedSpeechSince = null
      return
    }
    const now = performance.now()
    mutedSpeechSince ??= now
    if (now - mutedSpeechSince < MUTED_SPEECH_MS) return
    mutedSpeechTipShown = true
    setMutedSpeechTip(true)
    mutedSpeechTimer = setTimeout(() => setMutedSpeechTip(false), MUTED_SPEECH_TIP_MS)
  }
  onCleanup(() => {
    clearTimeout(mutedSpeechTimer)
  })
  // Unmuted, the tip has done its job.
  createEffect(() => {
    if (!muted()) setMutedSpeechTip(false)
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
        // The meter stops with the handle (a reconnect starts a new one).
        if (handle.sending) handle.meterMicrophone?.(onMicLevel)
        // Without a microphone because the OS refuses it: its settings can be opened (#85).
        if (!handle.sending) {
          void window.tolki.permissions
            .status('microphone')
            .then((state) => setMicDenied(state === 'denied'))
            .catch(() => undefined)
        }
        // Push-to-talk turned on before the call could start (joined muted): the key decides.
        if (ptt().enabled && muted() && handle.sending) setMuted(false)
        applyTransmit()
        // main writes the window's console.info to renderer.log (#106).
        console.info(`[call] started: ${handle.sending ? 'microphone on' : 'listening only'}`)
        // Still sharing from before the reconnect: send the same capture again.
        const track = myScreen()?.getVideoTracks()[0]
        if (track) {
          const sound = myScreen()?.getAudioTracks()[0] ?? null
          void handle.startScreen(track, sharingMode, sound).catch((error: unknown) => {
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
    setApproval(room.approval)
    // The organizer gets the requests again with the new welcome.
    setJoinRequests([])
    setSound('connecting')
    startTheCall(room, callEvents)
  }

  onMount(() => {
    void window.tolki.settings.get().then((settings) => {
      setVolumes((current) => ({ ...settings.audio.peerVolumes, ...current }))
      setOutputDeviceId(settings.audio.outputDeviceId)
      setSoundsOn(settings.sounds.enabled)
      if (settings.pushToTalk.enabled) changePtt(settings.pushToTalk, false)
      setHotkeyKeys(settings.globalHotkeys)
      // Once ever: the keys are in a list now, not on a line at the bottom (#110).
      if (!settings.hints.keys) {
        setKeysHint(true)
        void window.tolki.settings.update({ hints: { keys: true } }).catch(() => undefined)
      }
      setPickedMode(settings.screen.mode)
      if (settings.globalHotkeys.mute || settings.globalHotkeys.deafen) configureHotkeys()
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
    // The call first: push-to-talk then holds the voice back again (applyTransmit, on the signal).
    void call?.setMuted(value).catch((error: unknown) => {
      console.warn('[call] could not change the microphone:', error)
    })
    setMutedSignal(value)
  }

  // Push-to-talk (PLAN #39): the voice goes out only while the key is held. Main hooks the key
  // globally (over games); where it cannot, the key works while this window has focus.
  const [ptt, setPtt] = createSignal({ enabled: false, key: DEFAULT_PUSH_TO_TALK_KEY })
  const [pttMode, setPttMode] = createSignal<PushToTalkMode>('off')
  const [pttPressed, setPttPressed] = createSignal(false)
  /** The microphone as it was before push-to-talk: turning it off restores it. */
  let mutedBeforePtt = false
  const configurePtt = (askPermission: boolean): void => {
    const { enabled, key } = ptt()
    void window.tolki.ptt
      .configure({ active: enabled && !hasLeft(), key, askPermission })
      .then(setPttMode, () => {
        setPttMode(enabled ? 'focus' : 'off')
      })
  }
  // Global hotkeys (PLAN #40): set by the user, registered in main only during the call.
  const [hotkeyKeys, setHotkeyKeys] = createSignal<Record<HotkeyAction, string>>({
    mute: '',
    deafen: '',
  })
  const [hotkeyStatus, setHotkeyStatus] = createSignal<Record<HotkeyAction, HotkeyStatus>>({
    mute: 'none',
    deafen: 'none',
  })
  /** While a combination is being typed in «Настройки», nothing is registered. */
  let capturingHotkey = false
  const configureHotkeys = (): void => {
    void window.tolki.hotkeys
      .configure({ active: !hasLeft() && !capturingHotkey, ...hotkeyKeys() })
      .then(setHotkeyStatus, () => undefined)
  }

  // The tray menu shows the call as it is (PLAN #44).
  createEffect(() => {
    const state = {
      inCall: true,
      roomName: joined().room.name,
      muted: muted(),
      deafened: deafened(),
    }
    if (!hasLeft()) void window.tolki.tray.update(state).catch(() => undefined)
  })

  /** Held key, not deafened, microphone not off: only then the voice goes out. */
  const transmitting = (): boolean => pttPressed() && !deafened() && !muted()
  const applyTransmit = (): void => {
    if (!ptt().enabled) return
    // Read before `call?.`: with no call yet the arguments would not be read, and the effect
    // would stop following the key.
    const on = transmitting()
    call?.setTransmitting(on)
  }
  createEffect(applyTransmit)
  const changePtt = (next: { enabled: boolean; key: string }, askPermission: boolean): void => {
    const was = ptt().enabled
    if (next.enabled && !was) {
      mutedBeforePtt = muted()
      // The key decides now; the producer must be on at the host for it to work.
      if (muted() && canSpeak()) setMuted(false)
    }
    if (!next.enabled && was) {
      setPttPressed(false)
      call?.setTransmitting(true)
      if (mutedBeforePtt && canSpeak()) setMuted(true)
    }
    setPtt(next)
    applyTransmit()
    configurePtt(askPermission)
  }

  /** M: the microphone. Turning it on while deafened brings the sound back too. */
  const toggleMic = (): void => {
    // With push-to-talk the key decides.
    if (!canSpeak() || ptt().enabled) return
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
    // The push-to-talk key in this window (the global hook may be unavailable).
    if (ptt().enabled && event.code === ptt().key) {
      if (!isTyping(event.target) && !settingsOpen()) {
        setPttPressed(true)
        event.preventDefault()
      }
      return
    }
    // While a key is being set in the settings, keys belong to that field.
    if (settingsOpen()) return
    const key = callKeyOf(event, mac)
    if (key === null) return
    event.preventDefault()
    // With a modifier, so they work while typing in the chat too.
    if (key === 'shortcuts') {
      setShortcutsOpen((open) => !open)
      setKeysHint(false)
    } else if (!pickerOpen() && !shortcutsOpen()) {
      if (key === 'mic') toggleMic()
      else toggleSound()
    }
  }
  const onKeyUp = (event: KeyboardEvent): void => {
    if (ptt().enabled && event.code === ptt().key) setPttPressed(false)
  }
  // Leaving the window lets go of the key — unless main sees it everywhere.
  const onBlur = (): void => {
    if (pttMode() !== 'global') setPttPressed(false)
  }
  // Back from «Системные настройки»: «Универсальный доступ» may be allowed now.
  const onFocus = (): void => {
    if (ptt().enabled && pttMode() === 'needs-permission') configurePtt(false)
  }
  onMount(() => {
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    const stopGlobalKey = window.tolki.ptt.onKey(({ pressed }) => setPttPressed(pressed))
    // The tray's menu (PLAN #44): the same as the buttons and Ctrl+Shift+M / D.
    const stopTray = window.tolki.tray.onCommand(({ command }) => {
      untrack(() => {
        if (command === 'mute') toggleMic()
        else if (command === 'deafen') toggleSound()
        else void leave()
      })
    })
    // From IPC, outside any tracking scope, like room events.
    const stopHotkeys = window.tolki.hotkeys.onPressed(({ action }) => {
      untrack(() => {
        if (action === 'mute') toggleMic()
        else toggleSound()
      })
    })
    onCleanup(() => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      stopGlobalKey()
      stopHotkeys()
      stopTray()
    })
  })

  /** Another microphone mid-call: the producer swaps tracks, nobody reconnects (PLAN #24). */
  const switchMicrophone = (deviceId: string): void => {
    void call?.setInputDevice(deviceId).catch((error: unknown) => {
      console.warn('[call] could not switch the microphone:', error)
    })
  }

  const stopScreen = (): void => {
    if (myScreen()) console.info('[screen] sharing stopped')
    for (const track of myScreen()?.getTracks() ?? []) track.stop()
    setMyScreen(null)
    void call?.stopScreen().catch((error: unknown) => {
      console.warn('[screen] could not stop sending:', error)
    })
  }
  const shareScreen = async (
    sourceId: string | null,
    systemAudio: boolean,
    mode: ScreenMode,
  ): Promise<void> => {
    setPickerOpen(false)
    setScreenError(false)
    if (mode !== pickedMode()) {
      setPickedMode(mode)
      void window.tolki.settings.update({ screen: { mode } }).catch(() => undefined)
    }
    try {
      const stream = await (props.screen ?? browserScreen).capture(sourceId, systemAudio)
      stopScreen()
      // The system's own «stop sharing» or a closed window ends it too.
      const track = stream.getVideoTracks()[0]
      track?.addEventListener('ended', () => {
        if (myScreen() === stream) stopScreen()
      })
      setMyScreen(stream)
      // Everyone else gets it in the mode picked (sharp text, smooth motion or auto).
      if (track && call) {
        const sound = stream.getAudioTracks()[0] ?? null
        sharingMode = mode
        await call.startScreen(track, mode, sound)
        console.info(
          `[screen] sharing started: ${captureText(track)}, mode ${mode}` +
            (sound ? ', with the computer’s sound' : ''),
        )
      }
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

  /** The microphone button's tooltip, with its key (#110). */
  const micTip = (): string =>
    ptt().enabled
      ? `Говорить, пока нажата ${pushToTalkKeyLabel(ptt().key)}`
      : `${muted() ? 'Включить микрофон' : 'Выключить микрофон'} · ${callKeyLabel('mic', mac)}`
  const screenButton = (): { label: string } => {
    if (myScreen()) return { label: 'Остановить показ экрана' }
    if (askingToShare()) return { label: 'Ожидание ответа на запрос показа' }
    if (someoneElseShares()) return { label: 'Попросить показать свой экран' }
    return { label: 'Показать экран' }
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
        if (share) viewTransition(() => setView('stage'))
      },
    ),
  )

  const end = (): void => {
    stopScreen()
    if (!left) {
      // Out of the call: no global key hook (PLAN #39), no global hotkeys (PLAN #40).
      void window.tolki.ptt
        .configure({ active: false, key: ptt().key, askPermission: false })
        .catch(() => undefined)
      void window.tolki.hotkeys
        .configure({ active: false, mute: '', deafen: '' })
        .catch(() => undefined)
      void window.tolki.tray
        .update({ inCall: false, roomName: '', muted: false, deafened: false })
        .catch(() => undefined)
    }
    left = true
    call?.close()
    call = null
    events.stop()
  }
  onCleanup(end)

  /** The organizer's «Выйти» closes the room for all: one more step, never at once (#149). */
  const [confirmClose, setConfirmClose] = createSignal(false)
  const confirmPresence = createPresence(confirmClose)
  let leaveButton: HTMLButtonElement | undefined
  let stayButton: HTMLButtonElement | undefined
  const askLeave = (): void => {
    if (!isOrganizer()) {
      void leave()
      return
    }
    setConfirmClose((open) => !open)
    if (confirmClose()) queueMicrotask(() => stayButton?.focus())
  }
  const stay = (): void => {
    setConfirmClose(false)
    leaveButton?.focus()
  }
  onMount(() => {
    const dismiss = (event: Event): void => {
      if (!confirmClose()) return
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') stay()
        return
      }
      const target = event.target as Node
      if (
        !leaveButton?.contains(target) &&
        !document.querySelector('.call-close')?.contains(target)
      ) {
        setConfirmClose(false)
      }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', dismiss)
    onCleanup(() => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', dismiss)
    })
  })

  const leave = async (): Promise<void> => {
    setConfirmClose(false)
    end()
    await window.tolki.room.leave()
    props.onLeft()
  }

  const everyone = (): (Peer & { me: boolean })[] => [
    ...peers().map((peer) => ({ ...peer, me: false })),
    { id: joined().peerId, name, me: true, organizer: joined().organizer },
  ]
  // Tiles fill the space (#110): the biggest tiles for this window and this many people.
  const [tilesBox, setTilesBox] = createSignal({ width: 0, height: 0 })
  const observeTiles = (element: HTMLUListElement): void => {
    tilesList = element
    if (typeof ResizeObserver === 'undefined') return
    // The width from the container (the grid narrows itself to its rows), the height from the
    // grid (a «Смотреть» banner may take some above it).
    const container = element.parentElement ?? element
    const observer = new ResizeObserver(() => {
      // Less the grid's own 4 px padding on each side.
      setTilesBox({ width: container.clientWidth - 8, height: element.clientHeight - 8 })
    })
    observer.observe(element)
    observer.observe(container)
    onCleanup(() => {
      observer.disconnect()
    })
  }
  const tiles = createMemo(() =>
    tileLayout(everyone().length, tilesBox().width, tilesBox().height, TILE_GAP),
  )
  /** «Отдача организатора 39 Мбит/с — хватит на 15 человек и экран в 720p» for tooltips. */
  const hostUploadDetails = (): string | undefined => {
    const stats = hostStats()
    return stats ? `${hostUploadText(stats)} — ${hostUploadHint(stats).toLowerCase()}` : undefined
  }
  /** The organizer's upload in the call (#87), and a warning when it falls short. */
  // Over someone else's screen the call's chrome — the header, the bar, the people strip — goes
  // after 3 s without a mouse move and comes back on one (#110, #149), as in Meet and Zoom. Keyboard
  // focus keeps it; so does the confirmation of closing the room. Notices stay.
  const [chromeIdle, setChromeIdle] = createSignal(false)
  let chromeTimer: ReturnType<typeof setTimeout> | undefined
  const wakeChrome = (): void => {
    setChromeIdle(false)
    clearTimeout(chromeTimer)
    chromeTimer = setTimeout(() => setChromeIdle(true), CHROME_HIDE_MS)
  }
  onMount(wakeChrome)
  onCleanup(() => {
    clearTimeout(chromeTimer)
  })
  const chromeHidden = (): boolean =>
    chromeIdle() && (stage()?.consumerId ?? null) !== null && !confirmClose()

  const uploadWarning = (): string | null => {
    const stats = hostStats()
    return stats ? hostUploadWarning(stats, everyone().length, shownScreen() !== null) : null
  }

  return (
    <main
      class="call"
      classList={{ 'call--stage': stage() !== null, 'call--chrome-hidden': chromeHidden() }}
      onPointerMove={wakeChrome}
      onPointerDown={wakeChrome}
      onKeyDown={wakeChrome}
    >
      <header class="call-header">
        <div class="call-title">
          <h1>{joined().room.name}</h1>
          <span class="call-count">{peopleCount(everyone().length)}</span>
          <time class="call-timer" aria-label="Время в звонке">
            {formatCallTime(now() - joinedAt)}
          </time>
        </div>
        <div class="call-header-actions">
          <Show when={stage()}>
            <Button
              icon={<Users />}
              onClick={() => {
                viewTransition(() => setView('grid'))
              }}
            >
              Все участники
            </Button>
          </Show>
          <Show when={!props.organizer}>
            {/* The organizer's upload in its tooltip: details on hover, not a line of text (#110). */}
            <ConnectionIndicator
              sample={() => call?.connectionSample() ?? Promise.resolve(null)}
              offline={reconnecting()}
              details={hostUploadDetails()}
            />
          </Show>
          <Show when={isOrganizer()}>
            <RoomMenu
              approval={approval()}
              onApprovalChange={toggleApproval}
              upload={hostUploadDetails()}
            />
          </Show>
          <Show when={props.inviteLink}>
            {(link) => (
              <Button icon={<UserPlus />} onClick={() => void copyInvite(link())}>
                {linkCopied() ? 'Ссылка скопирована' : 'Пригласить'}
              </Button>
            )}
          </Show>
        </div>
      </header>
      <div class="call-body">
        <div class="call-content">
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
                          viewTransition(() => setView('stage'))
                        }}
                      >
                        Смотреть
                      </Button>
                    </div>
                  )}
                </Show>
                <ul
                  class="call-tiles"
                  classList={{ 'call-tiles--fit': tiles().width > 0 }}
                  style={
                    tiles().width > 0
                      ? {
                          '--tile-columns': String(tiles().columns),
                          '--tile-width': `${tiles().width}px`,
                        }
                      : {}
                  }
                  ref={observeTiles}
                  aria-label="Участники"
                >
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
                        onRemove={
                          isOrganizer() && !person.me
                            ? () => {
                                organizerRequest({ method: 'removePeer', peerId: person.id })
                              }
                            : undefined
                        }
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
                        style={{ 'view-transition-name': `person-${person.id}` }}
                        class="call-strip-person"
                        classList={{ 'call-strip-person--speaking': speaking().has(person.id) }}
                      >
                        <Avatar name={person.name} size="sm" />
                        <span class="call-strip-name">{person.name}</span>
                        <Show when={person.me}>
                          <span class="call-tile-you">я</span>
                        </Show>
                        <Show when={person.organizer}>
                          <span class="call-tile-organizer">организатор</span>
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
        <Show when={chatOpen()}>
          <ChatPanel
            messages={chat()}
            onSend={sendChat}
            onOpenLink={(url) => void window.tolki.app.openLink(url).catch(() => undefined)}
            onClose={() => setChatOpen(false)}
          />
        </Show>
      </div>
      <footer class="call-footer">
        {/* Over the content, above the bar: nothing below them moves when they come (#110). */}
        <div class="call-notices">
          <Show when={reconnecting()}>
            <p class="call-reconnecting" role="status">
              Переподключение…
            </p>
          </Show>
          <p
            class="call-sound"
            hidden={reconnecting()}
            role="status"
            // All is well: said to screen readers, not shown (#110).
            classList={{
              'call-sound--failed': sound() === 'failed',
              'visually-hidden': sound() === 'on',
            }}
          >
            <Switch>
              <Match when={sound() === 'connecting'}>Подключение звука…</Match>
              <Match when={sound() === 'on'}>Звук подключён</Match>
              <Match when={sound() === 'listen-only'}>
                {micDenied()
                  ? 'Нет доступа к микрофону — только прослушивание'
                  : 'Микрофон недоступен — только прослушивание'}
              </Match>
              <Match when={sound() === 'failed'}>
                Звук не подключился. Поможет повторный вход в комнату.
              </Match>
            </Switch>
          </p>
          <Show when={sound() === 'listen-only' && micDenied()}>
            <div class="call-request">
              <span>
                Доступ разрешается в системных настройках, затем нужно войти в комнату снова
              </span>
              <Button onClick={() => void window.tolki.permissions.openSettings('microphone')}>
                Открыть настройки
              </Button>
            </div>
          </Show>
          <For each={joinRequests().slice(0, 3)}>
            {(request) => (
              <div
                class="call-request"
                style={{ 'view-transition-name': `request-${request.requestId}` }}
                role="alert"
              >
                <span>{request.name} просит впустить</span>
                <Button
                  onClick={() => {
                    answerJoin(request.requestId, false)
                  }}
                >
                  Отклонить
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    answerJoin(request.requestId, true)
                  }}
                >
                  Впустить
                </Button>
              </div>
            )}
          </For>
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
          <Show when={uploadWarning()}>
            {(warning) => (
              <p class="call-sound call-sound--warning" role="status">
                {warning()}
              </p>
            )}
          </Show>
          <Show when={screenError()}>
            <p class="call-sound call-sound--failed" role="alert">
              Показ экрана не начался. Можно попробовать ещё раз или выбрать другое окно.
            </p>
          </Show>
          <Show when={mutedTipPresence.mounted()}>
            <div
              class="call-request call-muted-tip"
              data-closing={mutedTipPresence.closing() || undefined}
              role="status"
            >
              <span>Микрофон выключен — вас не слышно</span>
              <Button onClick={() => setMutedSpeechTip(false)}>Понятно</Button>
              <Button variant="primary" icon={<Mic />} onClick={toggleMic}>
                Включить
              </Button>
            </div>
          </Show>
          <Show when={keysHintPresence.mounted()}>
            <p
              class="call-keys-hint rt-glass rt-glass--sm"
              data-closing={keysHintPresence.closing() || undefined}
              role="status"
            >
              <span>
                Клавиши звонка — <kbd>{callKeyLabel('shortcuts', mac)}</kbd>
              </span>
              <button type="button" class="call-keys-hint-close" onClick={() => setKeysHint(false)}>
                Понятно
              </button>
            </p>
          </Show>
        </div>
        <div
          ref={liquidGlass}
          class="call-controls rt-glass rt-glass--liquid"
          role="toolbar"
          aria-label="Управление звонком"
        >
          <Tooltip text={micTip()}>
            {(tip) => (
              <button
                aria-describedby={tip}
                type="button"
                class="call-control call-control--mic"
                classList={{ 'call-control--off': ptt().enabled ? !transmitting() : muted() }}
                // The voice as it goes out: a ring that grows with it (#110).
                style={{
                  '--mic-level': String(
                    (ptt().enabled ? transmitting() : !muted() && canSpeak()) ? micLevel() : 0,
                  ),
                }}
                aria-pressed={ptt().enabled ? undefined : muted()}
                aria-label={
                  ptt().enabled
                    ? `Микрофон по клавише ${pushToTalkKeyLabel(ptt().key)}${transmitting() ? ', говорите' : ''}`
                    : muted()
                      ? 'Включить микрофон'
                      : 'Выключить микрофон'
                }
                disabled={!canSpeak() || ptt().enabled}
                onClick={toggleMic}
              >
                <span class="call-control-icon rt-glass-control">
                  {(ptt().enabled ? transmitting() : !muted()) ? <Mic /> : <MicOff />}
                </span>
              </button>
            )}
          </Tooltip>
          <Tooltip
            text={`${deafened() ? 'Включить звук' : 'Выключить звук'} · ${callKeyLabel('sound', mac)}`}
          >
            {(tip) => (
              <button
                aria-describedby={tip}
                type="button"
                class="call-control"
                classList={{ 'call-control--off': deafened() }}
                aria-pressed={deafened()}
                aria-label={deafened() ? 'Включить звук' : 'Выключить звук'}
                onClick={toggleSound}
              >
                <span class="call-control-icon rt-glass-control">
                  {deafened() ? <HeadphoneOff /> : <Headphones />}
                </span>
              </button>
            )}
          </Tooltip>
          <Tooltip text={screenButton().label}>
            {(tip) => (
              <button
                aria-describedby={tip}
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
                <span class="call-control-icon rt-glass-control">
                  {myScreen() ? <ScreenShareOff /> : <ScreenShare />}
                </span>
              </button>
            )}
          </Tooltip>
          <Tooltip text={'Чат'}>
            {(tip) => (
              <button
                aria-describedby={tip}
                type="button"
                class="call-control"
                classList={{ 'call-control--active': chatOpen() }}
                aria-pressed={chatOpen()}
                aria-label={unread() > 0 ? `Чат, новых сообщений: ${unread()}` : 'Чат'}
                onClick={() => {
                  setChatOpen((open) => !open)
                  setUnread(0)
                }}
              >
                <span class="call-control-icon rt-glass-control">
                  <MessageSquare />
                  <Show when={unread() > 0}>
                    <span class="call-control-badge" aria-hidden="true">
                      {unread() > 99 ? '99+' : unread()}
                    </span>
                  </Show>
                </span>
              </button>
            )}
          </Tooltip>
          <Tooltip text={'Настройки'}>
            {(tip) => (
              <button
                aria-describedby={tip}
                type="button"
                class="call-control"
                aria-label="Настройки"
                aria-haspopup="dialog"
                onClick={() => setSettingsOpen(true)}
              >
                <span class="call-control-icon rt-glass-control">
                  <Settings />
                </span>
              </button>
            )}
          </Tooltip>
          {/* The room lives on the organizer's computer: their leaving closes it for all. */}
          <Tooltip text={isOrganizer() ? 'Выйти и закрыть комнату' : 'Выйти из комнаты'}>
            {(tip) => (
              <button
                ref={(element) => {
                  leaveButton = element
                }}
                aria-describedby={tip}
                type="button"
                class="call-control call-control--leave"
                aria-label="Выйти"
                aria-haspopup={isOrganizer() ? 'dialog' : undefined}
                aria-expanded={isOrganizer() ? confirmClose() : undefined}
                onClick={askLeave}
              >
                <span class="call-control-icon rt-glass-control">
                  <LogOut />
                </span>
              </button>
            )}
          </Tooltip>
          <Show when={confirmPresence.mounted()}>
            <div
              class="call-close"
              role="dialog"
              aria-labelledby="call-close-title"
              data-closing={confirmPresence.closing() || undefined}
            >
              <p id="call-close-title" class="call-close-title">
                Комната закроется для всех участников
              </p>
              <div class="call-close-actions">
                <Button
                  ref={(element) => {
                    stayButton = element
                  }}
                  onClick={stay}
                >
                  Остаться
                </Button>
                <Button variant="danger" onClick={() => void leave()}>
                  Закрыть комнату
                </Button>
              </div>
            </div>
          </Show>
        </div>
        <ScreenSourceDialog
          open={pickerOpen()}
          onClose={() => setPickerOpen(false)}
          mode={screenMode()}
          onPick={(sourceId, systemAudio, mode) => void shareScreen(sourceId, systemAudio, mode)}
          {...(props.screen ? { access: props.screen } : {})}
        />
        <AudioSettingsDialog
          open={settingsOpen()}
          onClose={() => setSettingsOpen(false)}
          onInputChange={switchMicrophone}
          pushToTalk={ptt()}
          pushToTalkMode={pttMode()}
          onPushToTalkChange={changePtt}
          sounds={soundsOn()}
          onSoundsChange={setSoundsOn}
          globalHotkeys={hotkeyKeys()}
          hotkeyStatus={hotkeyStatus()}
          onGlobalHotkeysChange={(next) => {
            setHotkeyKeys(next)
            configureHotkeys()
          }}
          onHotkeyCapture={(capturing) => {
            capturingHotkey = capturing
            configureHotkeys()
          }}
          outputDeviceId={outputDeviceId()}
          onOutputChange={setOutputDeviceId}
          {...(props.microphone ? { access: props.microphone } : {})}
          {...(props.playTestSound ? { playTestSound: props.playTestSound } : {})}
        />
        <ShortcutsDialog
          open={shortcutsOpen()}
          onClose={() => setShortcutsOpen(false)}
          mac={mac}
          pushToTalkKey={ptt().enabled ? ptt().key : null}
          globalHotkeys={hotkeyKeys()}
        />
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

/** «1080p up to 60 fps» for the logs; logging must never break sharing (#106). */
function captureText(track: MediaStreamTrack): string {
  try {
    const { height, frameRate } = track.getSettings()
    return `${height ?? '?'}p up to ${frameRate ?? '?'} fps`
  } catch {
    return 'size unknown'
  }
}
