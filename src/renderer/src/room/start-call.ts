import type { ScreenMode } from '@shared/screen'
import { openMicrophoneTrack } from '../audio/microphone'
import {
  Call,
  type RemoteAudio,
  type RemoteScreen,
  type RoomEventSource,
  type ScreenLayer,
  type ScreenSample,
  type ConnectionSample,
} from './call'

export interface CallHandle {
  /** False when there is no microphone (denied or missing): the user only listens. */
  readonly sending: boolean
  setMuted(muted: boolean): Promise<void>
  /** Switches to another microphone on the fly (PLAN #24). */
  setInputDevice(deviceId: string): Promise<void>
  /** Sends a captured screen to the room (PLAN #27); the track stays the caller's. */
  startScreen(track: MediaStreamTrack, mode: ScreenMode): Promise<void>
  stopScreen(): Promise<void>
  /** Others' screens: shown or hidden, and the layer for the size shown (PLAN #28). */
  setScreenVisible(consumerId: string, visible: boolean): Promise<void>
  setScreenLayer(consumerId: string, layer: ScreenLayer): Promise<void>
  /** One screen at a time (PLAN #29): ask the sharer, or answer as the sharer. */
  requestScreen(): Promise<void>
  /** Numbers of someone's screen (consumer id) or the user's own (null), PLAN #30. */
  screenSample(consumerId: string | null): Promise<ScreenSample | null>
  /** The link to the organizer now (PLAN #32). */
  connectionSample(): Promise<ConnectionSample | null>
  answerScreenRequest(fromPeerId: string, accept: boolean): Promise<void>
  close(): void
}

export interface StartCallOptions {
  routerRtpCapabilities: Record<string, unknown>
  events: RoomEventSource
  muted: boolean
  onRemoteAudio: (voices: RemoteAudio[]) => void
  onRemoteScreens: (screens: RemoteScreen[]) => void
}

/** Opens the chosen microphone and starts the call; the microphone stops when the call does. */
export async function startCall(options: StartCallOptions): Promise<CallHandle> {
  const { audio } = await window.tolki.settings.get()
  let microphone = await openMicrophoneTrack(audio.inputDeviceId).catch((error: unknown) => {
    console.warn('[call] no microphone, joining to listen only:', error)
    return null
  })
  try {
    const call = await Call.start({ ...options, microphone })
    return {
      sending: call.producing,
      setMuted: (muted) => call.setMuted(muted),
      startScreen: (track, mode) => call.startScreen(track, mode),
      stopScreen: () => call.stopScreen(),
      setScreenVisible: (consumerId, visible) => call.setScreenVisible(consumerId, visible),
      setScreenLayer: (consumerId, layer) => call.setScreenLayer(consumerId, layer),
      requestScreen: () => call.requestScreen(),
      screenSample: (consumerId) => call.screenSample(consumerId),
      connectionSample: () => call.connectionSample(),
      answerScreenRequest: (fromPeerId, accept) => call.answerScreenRequest(fromPeerId, accept),
      setInputDevice: async (deviceId) => {
        if (!call.producing) return
        const track = await openMicrophoneTrack(deviceId)
        try {
          await call.replaceMicrophone(track)
        } catch (error) {
          track.stop()
          throw error
        }
        microphone?.stop()
        microphone = track
      },
      close: () => {
        call.close()
        microphone?.stop()
      },
    }
  } catch (error) {
    microphone?.stop()
    throw error
  }
}
