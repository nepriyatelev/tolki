import { createServer as createHttpsServer } from 'node:https'
import { connect, createServer, type Server, type Socket } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import { keepAlive } from './heartbeat'

export interface SignalingServerOptions {
  port: number
  key: string
  cert: string
  onConnection?: (socket: WebSocket, remoteAddress: string | undefined) => void
  /**
   * Loopback port of mediasoup's ICE-TCP listener. Media over TCP (the fallback when UDP is
   * blocked) arrives on the same public port as signalling and is passed on to it.
   */
  mediaTcpPort?: () => number | undefined
  /** Ping interval; a client silent for a whole interval is dropped (PLAN #31). */
  heartbeatMs?: number
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

/** First byte of a TLS record carrying a handshake (ClientHello). */
const TLS_HANDSHAKE = 0x16
/**
 * ICE-TCP frames (RFC 4571) start with a 16-bit length; STUN and DTLS packets are well under
 * 1500 bytes, so the first byte is small. TLS and HTTP never start like that.
 */
const MAX_ICE_TCP_FIRST_BYTE = 0x05

/**
 * HTTPS server that only speaks WebSocket (WSS). Plain HTTP/WS fails the TLS handshake;
 * HTTPS requests without an upgrade get 426. The same TCP port also carries media over ICE-TCP:
 * the first byte of a connection tells the two apart (PLAN §2 "Один порт").
 */
export async function startSignalingServer(
  options: SignalingServerOptions,
): Promise<SignalingServer> {
  const server = createHttpsServer({
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
  const front = createServer((socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.on('error', () => socket.destroy())
    socket.setTimeout(10_000, () => socket.destroy())
    socket.once('data', (chunk) => {
      socket.setTimeout(0)
      socket.pause()
      socket.unshift(chunk)
      const mediaPort = options.mediaTcpPort?.()
      const first = chunk[0] ?? TLS_HANDSHAKE
      if (mediaPort !== undefined && first <= MAX_ICE_TCP_FIRST_BYTE) {
        forward(socket, mediaPort)
      } else {
        server.emit('connection', socket)
      }
    })
  })

  await listen(front, options.port)

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
  wss.on('connection', (socket, request) => {
    keepAlive(socket, options.heartbeatMs ?? 10_000)
    options.onConnection?.(socket, request.socket.remoteAddress)
  })

  return {
    port: options.port,
    close: () => closeServer(front, wss, sockets),
  }
}

function forward(socket: Socket, port: number): void {
  const upstream = connect(port, '127.0.0.1')
  const drop = (): void => {
    socket.destroy()
    upstream.destroy()
  }
  upstream.on('error', drop)
  upstream.on('close', drop)
  socket.on('close', drop)
  socket.pipe(upstream).pipe(socket)
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
  front: Server,
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
    front.close(() => {
      resolve()
    })
    // Give clients a moment to finish the close handshake, then drop whatever is left.
    setTimeout(() => {
      for (const socket of sockets) socket.destroy()
    }, 500).unref()
  })
}
