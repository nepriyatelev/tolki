// Entry point of the `host` utility process: the room's signalling server, the SFU
// (mediasoup) and port forwarding.
import type { HostToMainMessage, MainToHostMessage } from '@shared/host-protocol'
import { normalizeAddress } from './attempt-limiter'
import { loadOrCreateCertificate } from './certificate'
import { MediaServer, MediaServerStartError } from './media-server'
import { mapHostPort } from './nat'
import type { PortMappingSession } from './nat/port-mapper'
import { Room } from './room'
import { SignalingServerStartError, startSignalingServer, type SignalingServer } from './server'
import { monitorUpload } from './upload-monitor'

const port = process.parentPort
let server: SignalingServer | null = null
let room: Room | null = null
let media: MediaServer | null = null
let stopMonitor: (() => void) | null = null
let mapping: Promise<PortMappingSession> | null = null
let stopping = false

/** Upper bound for removing port mappings on shutdown; main kills us after 5 s anyway. */
const UNMAP_TIMEOUT_MS = 3000

function send(message: HostToMainMessage): void {
  port.postMessage(message)
}

async function start(message: Extract<MainToHostMessage, { type: 'start' }>): Promise<void> {
  try {
    const certificate = await loadOrCreateCertificate(message.dataDir)
    // Signalling first: it owns the TCP port, so a busy port is reported the usual way.
    server = await startSignalingServer({
      port: message.port,
      key: certificate.key,
      cert: certificate.cert,
      onConnection: (socket, address) => {
        room?.accept(socket, normalizeAddress(address))
      },
      mediaTcpPort: () => media?.tcpPort,
    })
    media = await MediaServer.start({
      port: message.port,
      onDied: (error) => {
        send({ type: 'fatal', message: `mediasoup worker died: ${error.message}` })
        process.exit(1)
      },
    })
    const sfu = media
    room = new Room(
      { name: message.roomName, password: message.password, fingerprint: certificate.fingerprint },
      { media: sfu },
    )
    stopMonitor = monitorUpload(
      () => room?.transports ?? [],
      (capacity) => {
        send({ type: 'call-upload', capacity })
      },
    )
    send({ type: 'ready', port: server.port, fingerprint: certificate.fingerprint })
  } catch (error) {
    if (error instanceof SignalingServerStartError || error instanceof MediaServerStartError) {
      send({ type: 'start-failed', reason: error.reason, message: error.message })
    } else {
      send({ type: 'start-failed', reason: 'unknown', message: String(error) })
    }
    process.exit(1)
  }

  if (message.portMapping) {
    mapping = mapHostPort(message.port)
    const session = await mapping
    if (session.state.status === 'mapped') {
      media.publicUdpPort = session.state.externalUdpPort
    }
    if (!stopping) send({ type: 'port-mapping', state: session.state })
  }
}

async function check(message: Extract<MainToHostMessage, { type: 'check' }>): Promise<void> {
  const session = await mapHostPort(message.port)
  await Promise.race([
    session.close(),
    new Promise((resolve) => setTimeout(resolve, UNMAP_TIMEOUT_MS)),
  ])
  send({ type: 'check-result', portMapping: session.state })
  process.exit(0)
}

async function shutdown(): Promise<void> {
  if (stopping) return
  stopping = true
  // Participants learn the room was closed on purpose before the connection drops.
  room?.close()
  stopMonitor?.()
  media?.close()
  const unmap = mapping?.then((session) => session.close())
  await Promise.race([unmap, new Promise((resolve) => setTimeout(resolve, UNMAP_TIMEOUT_MS))])
  await server?.close()
  process.exit(0)
}

process.on('uncaughtException', (error) => {
  send({ type: 'fatal', message: error.stack ?? error.message })
  process.exit(1)
})

port.on('message', (event) => {
  const message = event.data as MainToHostMessage | null
  switch (message?.type) {
    case 'start':
      void start(message)
      return
    case 'check':
      void check(message)
      return
    case 'shutdown':
      void shutdown()
      return
  }
})
