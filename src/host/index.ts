// Entry point of the `host` utility process: the room's signalling server.
// mediasoup and NAT mapping join it in issues #8 and #19.
import type { HostToMainMessage, MainToHostMessage } from '@shared/host-protocol'
import { loadOrCreateCertificate } from './certificate'
import { SignalingServerStartError, startSignalingServer, type SignalingServer } from './server'

const port = process.parentPort
let server: SignalingServer | null = null
let stopping = false

function send(message: HostToMainMessage): void {
  port.postMessage(message)
}

async function start(message: Extract<MainToHostMessage, { type: 'start' }>): Promise<void> {
  try {
    const certificate = await loadOrCreateCertificate(message.dataDir)
    server = await startSignalingServer({
      port: message.port,
      key: certificate.key,
      cert: certificate.cert,
    })
    send({ type: 'ready', port: server.port, fingerprint: certificate.fingerprint })
  } catch (error) {
    if (error instanceof SignalingServerStartError) {
      send({ type: 'start-failed', reason: error.reason, message: error.message })
    } else {
      send({ type: 'start-failed', reason: 'unknown', message: String(error) })
    }
    process.exit(1)
  }
}

async function shutdown(): Promise<void> {
  if (stopping) return
  stopping = true
  // Future: remove port mappings here too.
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
    case 'shutdown':
      void shutdown()
      return
  }
})
