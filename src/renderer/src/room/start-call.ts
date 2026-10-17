import { openMicrophoneTrack } from '../audio/microphone'
import { Call, type RemoteAudio, type RoomEventSource } from './call'

export interface CallHandle {
  /** False when there is no microphone (denied or missing): the user only listens. */
  readonly sending: boolean
  setMuted(muted: boolean): Promise<void>
  /** Switches to another microphone on the fly (PLAN #24). */
  setInputDevice(deviceId: string): Promise<void>
  close(): void
}

export interface StartCallOptions {
  routerRtpCapabilities: Record<string, unknown>
  events: RoomEventSource
  muted: boolean
  onRemoteAudio: (voices: RemoteAudio[]) => void
}

/** Opens the chosen microphone and starts the call; the microphone stops when the call does. */
export async function startCall(options: StartCallOptions): Promise<CallHandle> {
  const { audio } = await window.ratatosk.settings.get()
  let microphone = await openMicrophoneTrack(audio.inputDeviceId).catch((error: unknown) => {
    console.warn('[call] no microphone, joining to listen only:', error)
    return null
  })
  try {
    const call = await Call.start({ ...options, microphone })
    return {
      sending: call.producing,
      setMuted: (muted) => call.setMuted(muted),
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
