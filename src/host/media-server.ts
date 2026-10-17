import { sep } from 'node:path'
import * as mediasoup from 'mediasoup'
import type { types } from 'mediasoup'
import type { TransportParameters } from '@shared/signaling'
import { FORWARDED_VOICES } from './speakers'

/** Codecs the room's router speaks. Video codecs join with screen sharing (M3). */
const MEDIA_CODECS: types.RouterRtpCodecCapability[] = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
]

export class MediaServerStartError extends Error {
  constructor(
    readonly reason: 'port-in-use' | 'unknown',
    message: string,
  ) {
    super(message)
    this.name = 'MediaServerStartError'
  }
}

export interface MediaServerOptions {
  /** Public port: media over UDP listens on it, ICE-TCP is announced on it. */
  port: number
  /** Called if the mediasoup worker dies; the room cannot go on without it. */
  onDied?: (error: Error) => void
}

export type TransportDirection = 'send' | 'recv'
export type MediaTransport = types.WebRtcTransport<{ direction: TransportDirection }>

/**
 * mediasoup worker + router + WebRtcServer (PLAN §2): every transport shares one UDP port.
 * ICE-TCP listens on loopback; the signalling server passes TCP media from the public port to it.
 */
export class MediaServer {
  /** UDP port clients should send to; differs from `port` if the router mapped another one. */
  publicUdpPort: number

  private constructor(
    readonly port: number,
    readonly tcpPort: number,
    private readonly worker: types.Worker,
    readonly router: types.Router,
    private readonly webRtcServer: types.WebRtcServer,
    /** Who is loud right now: drives the forwarded voices and the speaking frame. */
    readonly audioLevels: types.AudioLevelObserver,
  ) {
    this.publicUdpPort = port
  }

  static async start(options: MediaServerOptions): Promise<MediaServer> {
    const worker = await mediasoup.createWorker({ logLevel: 'warn', workerBin: workerBin() })
    worker.on('died', (error) => {
      options.onDied?.(error)
    })
    try {
      const router = await worker.createRouter({ mediaCodecs: MEDIA_CODECS })
      const webRtcServer = await createWebRtcServer(worker, options.port)
      const { tcpServers } = await webRtcServer.dump()
      const tcpPort = tcpServers[0]?.port
      if (tcpPort === undefined) throw new Error('mediasoup did not open an ICE-TCP listener')
      const audioLevels = await router.createAudioLevelObserver({
        maxEntries: FORWARDED_VOICES,
        // dBov: quieter than this is background noise, not speech.
        threshold: -55,
        interval: 300,
      })
      return new MediaServer(options.port, tcpPort, worker, router, webRtcServer, audioLevels)
    } catch (error) {
      worker.close()
      throw toStartError(error, options.port)
    }
  }

  get rtpCapabilities(): types.RtpCapabilities {
    return this.router.rtpCapabilities
  }

  createTransport(direction: TransportDirection): Promise<MediaTransport> {
    return this.router.createWebRtcTransport({
      webRtcServer: this.webRtcServer,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      appData: { direction },
    })
  }

  /** What the client needs for its side, with candidates pointing at the public ports. */
  parametersOf(transport: MediaTransport): TransportParameters {
    return {
      id: transport.id,
      iceParameters: { ...transport.iceParameters },
      iceCandidates: transport.iceCandidates.map((candidate) => ({
        ...candidate,
        port: candidate.protocol === 'tcp' ? this.port : this.publicUdpPort,
      })),
      dtlsParameters: { ...transport.dtlsParameters },
    }
  }

  close(): void {
    this.worker.close()
  }
}

async function createWebRtcServer(worker: types.Worker, port: number): Promise<types.WebRtcServer> {
  const tcp: types.TransportListenInfo = { protocol: 'tcp', ip: '127.0.0.1', port: 0 }
  try {
    // Dual-stack: one socket for IPv4 and IPv6 friends.
    return await worker.createWebRtcServer({
      listenInfos: [{ protocol: 'udp', ip: '::', port, flags: { ipv6Only: false } }, tcp],
    })
  } catch (error) {
    if (isPortInUse(error)) throw error
    // No IPv6 on this machine.
    return worker.createWebRtcServer({
      listenInfos: [{ protocol: 'udp', ip: '0.0.0.0', port }, tcp],
    })
  }
}

/** Inside a packaged app the worker binary is unpacked next to app.asar (asarUnpack). */
function workerBin(): string {
  return mediasoup.workerBin.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`)
}

function isPortInUse(error: unknown): boolean {
  return error instanceof Error && /EADDRINUSE|address already in use/i.test(error.message)
}

function toStartError(error: unknown, port: number): MediaServerStartError {
  if (error instanceof MediaServerStartError) return error
  if (isPortInUse(error)) {
    return new MediaServerStartError('port-in-use', `UDP port ${port} is already in use`)
  }
  return new MediaServerStartError(
    'unknown',
    error instanceof Error ? error.message : String(error),
  )
}
