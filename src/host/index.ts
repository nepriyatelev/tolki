// Entry point of the `host` utility process. Signalling, mediasoup and NAT mapping
// will live here (issues #7, #8, #19); for now it only implements the lifecycle.
import type { HostToMainMessage, MainToHostMessage } from '@shared/host-protocol'

const port = process.parentPort

function send(message: HostToMainMessage): void {
  port.postMessage(message)
}

function shutdown(): void {
  // Future: close servers and remove port mappings before exiting.
  process.exit(0)
}

process.on('uncaughtException', (error) => {
  send({ type: 'fatal', message: error.stack ?? error.message })
  process.exit(1)
})

port.on('message', (event) => {
  const message = event.data as Partial<MainToHostMessage> | null
  if (message?.type === 'shutdown') shutdown()
})

send({ type: 'ready' })
