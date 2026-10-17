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

export interface SentVideo {
  codec: string
  contentHint: string
  layers: { rid: string; framesEncoded: number; frameHeight: number; encoder: string }[]
}

/** What the app sends as video: codec, the track's hint and each simulcast layer. */
export function sentVideo(page: Page): Promise<SentVideo | null> {
  return page.evaluate(async () => {
    const { connections } = window as unknown as { connections: RTCPeerConnection[] }
    for (const pc of connections) {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video')
      if (!sender?.track) continue
      const stats = [...(await sender.getStats()).values()] as {
        type: string
        mimeType?: string
        rid?: string
        framesEncoded?: number
        frameHeight?: number
        encoderImplementation?: string
      }[]
      const codec = stats.find((s) => s.type === 'codec')
      return {
        codec: codec?.mimeType ?? '',
        contentHint: sender.track.contentHint,
        layers: stats
          .filter((s) => s.type === 'outbound-rtp')
          .map((s) => ({
            rid: s.rid ?? '',
            framesEncoded: s.framesEncoded ?? 0,
            frameHeight: s.frameHeight ?? 0,
            encoder: s.encoderImplementation ?? '',
          }))
          .sort((a, b) => a.rid.localeCompare(b.rid)),
      }
    }
    return null
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

/** The screen this app receives: decoded frames and the height of the layer it gets. */
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
      }[]
      // mediasoup's 'probator' stream only probes bandwidth; the screen is the other one.
      const inbound = stats.find(
        (s) => s.type === 'inbound-rtp' && s.kind === 'video' && s.mid !== 'probator',
      )
      if (inbound) {
        return { framesDecoded: inbound.framesDecoded ?? 0, frameHeight: inbound.frameHeight ?? 0 }
      }
    }
    return null
  })
}
