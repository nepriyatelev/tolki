import { sep } from 'node:path'
import * as mediasoup from 'mediasoup'
import type { types } from 'mediasoup'
import type { TransportParameters } from '@shared/signaling'
import { VOICE, VOICE_OPUS_PARAMETERS } from '@shared/voice'
import { MAX_PARTICIPANTS } from '@shared/upload-capacity'

/**
 * Codecs the room's router speaks. Opus is always "/48000/2" in WebRTC; the voice itself is mono
 * (stereo=0).
 */
const MEDIA_CODECS: types.RouterRtpCodecCapability[] = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: VOICE.sampleRate,
    channels: 2,
    parameters: { ...VOICE_OPUS_PARAMETERS },
  },
  // Screen sharing (PLAN #27): H.264 first, as computers encode it in hardware; VP8 as fallback.
  // Baseline (42001f), not constrained baseline (42e01f): Chromium on macOS encodes only the
  // former with VideoToolbox, the latter falls back to the software OpenH264 (#34).
  {
    kind: 'video',
    mimeType: 'video/H264',
    clockRate: 90000,
    parameters: {
      'packetization-mode': 1,
      'profile-level-id': '42001f',
      'level-asymmetry-allowed': 1,
    },
  },
  { kind: 'video', mimeType: 'video/VP8', clockRate: 90000 },
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
        // Everyone above the threshold: the selector keeps talking voices (and the speaking
        // frame shows them all); only the three loudest can take a free or quiet slot.
        maxEntries: MAX_PARTICIPANTS,
        // dBov: quieter than this is background noise, not speech.
        threshold: -70,
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
