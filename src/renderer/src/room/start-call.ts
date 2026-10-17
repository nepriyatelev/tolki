import { Call, type RemoteAudio, type RoomEventSource } from './call'

export interface CallHandle {
  /** False when there is no microphone (denied or missing): the user only listens. */
  readonly sending: boolean
  setMuted(muted: boolean): Promise<void>
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
  const microphone = await openMicrophone()
  try {
    const call = await Call.start({ ...options, microphone })
    return {
      sending: call.producing,
      setMuted: (muted) => call.setMuted(muted),
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

async function openMicrophone(): Promise<MediaStreamTrack | null> {
  const { audio } = await window.ratatosk.settings.get()
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(audio.inputDeviceId !== '' ? { deviceId: { ideal: audio.inputDeviceId } } : {}),
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    return stream.getAudioTracks()[0] ?? null
  } catch (error) {
    console.warn('[call] no microphone, joining to listen only:', error)
    return null
  }
}
