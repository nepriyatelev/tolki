import { createServer, type Server } from 'node:https'
import type { Socket } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'

export interface SignalingServerOptions {
  port: number
  key: string
  cert: string
  onConnection?: (socket: WebSocket) => void
}

export interface SignalingServer {
  readonly port: number
  close(): Promise<void>
}

export type StartFailureReason = 'port-in-use' | 'port-forbidden' | 'unknown'

export class SignalingServerStartError extends Error {
  constructor(
    readonly reason: StartFailureReason,
    message: string,
  ) {
    super(message)
    this.name = 'SignalingServerStartError'
  }
}

/** Signalling messages are small JSON; anything bigger is a bug or abuse. */
const MAX_MESSAGE_BYTES = 64 * 1024

/**
 * HTTPS server that only speaks WebSocket (WSS). Plain HTTP/WS fails the TLS handshake;
 * HTTPS requests without an upgrade get 426.
 */
export async function startSignalingServer(
  options: SignalingServerOptions,
): Promise<SignalingServer> {
  const server = createServer({
    key: options.key,
    cert: options.cert,
    minVersion: 'TLSv1.3',
  })
  server.requestTimeout = 10_000
  server.headersTimeout = 10_000

  server.on('request', (_req, res) => {
    res.writeHead(426, { Upgrade: 'websocket', Connection: 'close', 'Content-Type': 'text/plain' })
    res.end('WebSocket only\n')
  })

  const sockets = new Set<Socket>()
  server.on('connection', (socket: Socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })

  await listen(server, options.port)

  // Attach only after listen succeeded: ws re-emits server errors on itself, and an
  // unhandled 'error' there would turn EADDRINUSE into an uncaught exception.
  const wss = new WebSocketServer({
    server,
    maxPayload: MAX_MESSAGE_BYTES,
    perMessageDeflate: false,
  })
  wss.on('error', (error) => {
    console.error('[host] websocket server error:', error)
  })
  wss.on('connection', (socket) => {
    options.onConnection?.(socket)
  })

  return {
    port: options.port,
    close: () => closeServer(server, wss, sockets),
  }
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.off('listening', onListening)
      reject(toStartError(error, port))
    }
    const onListening = (): void => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    // No host: Node listens on [::] (dual-stack IPv4 + IPv6) when IPv6 is available.
    server.listen(port)
  })
}

function toStartError(error: NodeJS.ErrnoException, port: number): SignalingServerStartError {
  switch (error.code) {
    case 'EADDRINUSE':
      return new SignalingServerStartError('port-in-use', `Port ${port} is already in use`)
    case 'EACCES':
      return new SignalingServerStartError('port-forbidden', `No permission to use port ${port}`)
    default:
      return new SignalingServerStartError('unknown', error.message)
  }
}

async function closeServer(
  server: Server,
  wss: WebSocketServer,
  sockets: Set<Socket>,
): Promise<void> {
  for (const client of wss.clients) client.close(1001, 'Host is shutting down')
  await new Promise<void>((resolve) => {
    wss.close(() => {
      resolve()
    })
  })
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve()
    })
    // Give clients a moment to finish the close handshake, then drop whatever is left.
    setTimeout(() => {
      for (const socket of sockets) socket.destroy()
    }, 500).unref()
  })
}
