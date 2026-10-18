import type { ElectronApplication, Page } from '@playwright/test'

/** Records the app's peer connections, to read what is actually negotiated and sent. */
export function tapPeerConnections(page: Page): Promise<void> {
  return page.evaluate(() => {
    const connections: RTCPeerConnection[] = []
    Object.assign(window, { connections })
    const Original = window.RTCPeerConnection
    window.RTCPeerConnection = class extends Original {
      constructor(config?: RTCConfiguration) {
        super(config)
        connections.push(this)
      }
    }
  })
}

export interface SentStream {
  codec: string
  contentHint: string
  framesEncoded: number
  frameHeight: number
  encoder: string
  /** Encoded in hardware. */
  powerEfficient: boolean
}

/** What the app sends as video: each stream of the screen (≈1080p first, then ≈360p — #34). */
export function sentVideo(page: Page): Promise<SentStream[]> {
  return page.evaluate(async () => {
    const { connections } = window as unknown as { connections: RTCPeerConnection[] }
    const streams: SentStream[] = []
    for (const pc of connections) {
      for (const sender of pc.getSenders()) {
        // Read before awaiting: stopping the screen takes the track away meanwhile.
        const track = sender.track
        if (track?.kind !== 'video') continue
        const stats = [...(await sender.getStats()).values()] as {
          type: string
          mimeType?: string
          framesEncoded?: number
          frameHeight?: number
          encoderImplementation?: string
          powerEfficientEncoder?: boolean
        }[]
        const outbound = stats.find((s) => s.type === 'outbound-rtp')
        streams.push({
          codec: stats.find((s) => s.type === 'codec')?.mimeType ?? '',
          contentHint: track.contentHint,
          framesEncoded: outbound?.framesEncoded ?? 0,
          frameHeight: outbound?.frameHeight ?? 0,
          encoder: outbound?.encoderImplementation ?? '',
          powerEfficient: outbound?.powerEfficientEncoder ?? false,
        })
      }
    }
    return streams
  })
}

/**
 * CPU of the app's processes, percent of one core, summed. Electron measures usage since the
 * previous call, so this samples twice, a second apart.
 */
export async function cpuPercent(app: ElectronApplication): Promise<number> {
  const sample = () =>
    app.evaluate(({ app: electronApp }) =>
      electronApp.getAppMetrics().reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0),
    )
  await sample()
  await new Promise((resolve) => setTimeout(resolve, 1000))
  return sample()
}

/**
 * The screen this app receives: frames decoded of all its streams, and the height of the one
 * that arrives now (the host sends one of the two — #34).
 */
export function receivedVideo(
  page: Page,
): Promise<{ framesDecoded: number; frameHeight: number } | null> {
  return page.evaluate(async () => {
    const { connections } = window as unknown as { connections: RTCPeerConnection[] }
    for (const pc of connections) {
      const stats = [...(await pc.getStats()).values()] as {
        type: string
        kind?: string
        framesDecoded?: number
        frameHeight?: number
        mid?: string
        lastPacketReceivedTimestamp?: number
      }[]
      // mediasoup's 'probator' stream only probes bandwidth; the screen is the others.
      const inbound = stats.filter(
        (s) => s.type === 'inbound-rtp' && s.kind === 'video' && s.mid !== 'probator',
      )
      if (inbound.length > 0) {
        const latest = inbound.reduce((a, b) =>
          (b.lastPacketReceivedTimestamp ?? 0) > (a.lastPacketReceivedTimestamp ?? 0) ? b : a,
        )
        return {
          framesDecoded: inbound.reduce((sum, s) => sum + (s.framesDecoded ?? 0), 0),
          frameHeight: latest.frameHeight ?? 0,
        }
      }
    }
    return null
  })
}

/** Loudest level of the remote voice played on this page over a short window (0 = silence). */
export function heardLevel(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const audio = document.querySelector('audio[data-peer-id]')
    if (!(audio instanceof HTMLAudioElement) || !(audio.srcObject instanceof MediaStream)) return 0
    const context = new AudioContext()
    const analyser = context.createAnalyser()
    context.createMediaStreamSource(audio.srcObject).connect(analyser)
    const samples = new Float32Array(analyser.fftSize)
    let loudest = 0
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      analyser.getFloatTimeDomainData(samples)
      for (const s of samples) loudest = Math.max(loudest, Math.abs(s))
    }
    await context.close()
    return loudest
  })
}
