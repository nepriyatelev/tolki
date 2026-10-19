import type { ScreenMode } from '@shared/screen'
import type { ScreenBudget } from '@shared/upload-capacity'
import { meterTrack, openMicrophoneTrack } from '../audio/microphone'
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
  /** Push-to-talk: sends the voice only while the key is held, without telling the host. */
  setTransmitting(on: boolean): void
  /** Switches to another microphone on the fly (PLAN #24). */
  setInputDevice(deviceId: string): Promise<void>
  /** Sends a captured screen to the room (PLAN #27); the track stays the caller's. */
  /** With `audio`: the computer's sound goes along (#41). */
  startScreen(
    track: MediaStreamTrack,
    mode: ScreenMode,
    audio?: MediaStreamTrack | null,
  ): Promise<void>
  stopScreen(): Promise<void>
  /** The host's ceiling for the big screen stream (#86). */
  setScreenBudget(budget: ScreenBudget): Promise<void>
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
  /**
   * The user's own voice level (0..1), muted or not, following a switch of microphone (#110).
   * Returns the stop function. Absent where there is nothing to measure.
   */
  meterMicrophone?(onLevel: (level: number) => void): () => void
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
  /** Level listeners: the meter moves to a new microphone with them. */
  const meters = new Map<(level: number) => void, () => void>()
  try {
    const call = await Call.start({ ...options, microphone })
    return {
      sending: call.producing,
      setMuted: (muted) => call.setMuted(muted),
      setTransmitting: (on) => {
        call.setTransmitting(on)
      },
      startScreen: (track, mode, audio) => call.startScreen(track, mode, audio ?? null),
      stopScreen: () => call.stopScreen(),
      setScreenBudget: (budget) => call.setScreenBudget(budget),
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
        for (const [onLevel, stop] of meters) {
          stop()
          meters.set(onLevel, meterTrack(track, onLevel))
        }
      },
      meterMicrophone: (onLevel) => {
        meters.set(onLevel, meterTrack(microphone, onLevel))
        return () => {
          meters.get(onLevel)?.()
          meters.delete(onLevel)
        }
      },
      close: () => {
        for (const stop of meters.values()) stop()
        meters.clear()
        call.close()
        microphone?.stop()
      },
    }
  } catch (error) {
    microphone?.stop()
    throw error
  }
}
