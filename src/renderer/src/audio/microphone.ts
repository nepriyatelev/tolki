import { VOICE } from '@shared/voice'

export interface AudioInput {
  deviceId: string
  label: string
}

export type MicrophoneProblem = 'denied' | 'not-found' | 'unavailable'

export class MicrophoneError extends Error {
  constructor(readonly problem: MicrophoneProblem) {
    super(problem)
    this.name = 'MicrophoneError'
  }
}

/** Microphone access for the join screen; tests swap in a fake. */
export interface MicrophoneAccess {
  listInputs(): Promise<AudioInput[]>
  /** Speakers and headphones (labels need microphone access first). */
  listOutputs(): Promise<AudioInput[]>
  /** Starts reporting the input level (0..1) for a device; resolves with a stop function. */
  openMeter(deviceId: string, onLevel: (level: number) => void): Promise<() => void>
}

function toMicrophoneError(error: unknown): MicrophoneError {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return new MicrophoneError('denied')
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new MicrophoneError('not-found')
  }
  return new MicrophoneError('unavailable')
}

async function listDevices(kind: MediaDeviceKind, fallback: string): Promise<AudioInput[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((d) => d.kind === kind && d.deviceId !== 'default' && d.deviceId !== '')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `${fallback} ${i + 1}` }))
}

/** The microphone for a voice call (PLAN #25): mono, 48 kHz, voice processing on. */
export function microphoneConstraints(deviceId: string): MediaTrackConstraints {
  return {
    ...(deviceId !== '' ? { deviceId: { exact: deviceId } } : {}),
    channelCount: { ideal: VOICE.channels },
    sampleRate: { ideal: VOICE.sampleRate },
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  }
}

/** The microphone track for the call. */
export async function openMicrophoneTrack(deviceId: string): Promise<MediaStreamTrack> {
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints(deviceId) })
  } catch (error) {
    throw toMicrophoneError(error)
  }
  const track = stream.getAudioTracks()[0]
  if (!track) throw new MicrophoneError('not-found')
  return track
}

export const browserMicrophone: MicrophoneAccess = {
  listInputs: () => listDevices('audioinput', 'Микрофон'),
  listOutputs: () => listDevices('audiooutput', 'Динамики'),

  async openMeter(deviceId, onLevel) {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: microphoneConstraints(deviceId),
      })
    } catch (error) {
      throw toMicrophoneError(error)
    }

    const context = new AudioContext()
    const analyser = context.createAnalyser()
    analyser.fftSize = 1024
    context.createMediaStreamSource(stream).connect(analyser)
    const samples = new Float32Array(analyser.fftSize)
    let level = 0
    let frame = 0

    const tick = (): void => {
      analyser.getFloatTimeDomainData(samples)
      let sum = 0
      for (const s of samples) sum += s * s
      const rms = Math.sqrt(sum / samples.length)
      // Speech sits around 0.02–0.2 RMS; scale so a normal voice fills most of the meter.
      const target = Math.min(1, rms * 5)
      // Fast attack, slow release: the bar follows the voice without flickering.
      level = target > level ? target : level * 0.85 + target * 0.15
      onLevel(level)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      for (const track of stream.getTracks()) track.stop()
      void context.close()
    }
  },
}
