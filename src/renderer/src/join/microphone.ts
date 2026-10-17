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

export const browserMicrophone: MicrophoneAccess = {
  async listInputs() {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== '')
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Микрофон ${i + 1}` }))
  },

  async openMeter(deviceId, onLevel) {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId !== '' ? { deviceId: { exact: deviceId } } : {}),
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
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
