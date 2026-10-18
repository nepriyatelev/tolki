import { mkdtemp, rm } from 'node:fs/promises'
import { request } from 'node:https'
import { createServer as createNetServer, connect, Socket, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TLSSocket } from 'node:tls'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import {
  certificateFingerprint,
  loadOrCreateCertificate,
  type HostCertificate,
} from './certificate'
import { SignalingServerStartError, startSignalingServer, type SignalingServer } from './server'

let dir: string
let certificate: HostCertificate
let server: SignalingServer | null = null

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tolki-server-'))
  certificate = await loadOrCreateCertificate(dir)
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

afterEach(async () => {
  await server?.close()
  server = null
})

async function freePort(): Promise<number> {
  const probe = createNetServer()
  await new Promise<void>((resolve) => {
    probe.listen(0, resolve)
  })
  const { port } = probe.address() as AddressInfo
  await new Promise<void>((resolve) => {
    probe.close(() => {
      resolve()
    })
  })
  return port
}

async function start(): Promise<SignalingServer> {
  server = await startSignalingServer({
    port: await freePort(),
    key: certificate.key,
    cert: certificate.cert,
  })
  return server
}

/** Connects like a client that pins the certificate by fingerprint instead of a CA. */
function connectWss(url: string): Promise<{ socket: WebSocket; fingerprint: string }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { rejectUnauthorized: false })
    socket.once('upgrade', (res) => {
      const tls = res.socket as TLSSocket
      const peer = tls.getPeerX509Certificate()
      if (!peer) {
        reject(new Error('no peer certificate'))
        return
      }
      resolve({ socket, fingerprint: certificateFingerprint(peer.toString()) })
    })
    socket.once('error', reject)
  })
}

function rawRequest(port: number, payload: string): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1')
    let data = ''
    socket.on('data', (chunk: Buffer) => {
      data += chunk.toString('latin1')
    })
    socket.on('close', () => {
      resolve(data)
    })
    socket.on('error', () => {
      resolve(data)
    })
    socket.setTimeout(2000, () => socket.destroy())
    socket.write(payload)
  })
}

describe('startSignalingServer', () => {
  it('accepts WSS connections and presents the certificate the fingerprint refers to', async () => {
    const { port } = await start()

    const { socket, fingerprint } = await connectWss(`wss://127.0.0.1:${port}/`)

    expect(fingerprint).toBe(certificate.fingerprint)
    expect(socket.readyState).toBe(WebSocket.OPEN)
    socket.close()
  })

  it('listens on IPv6 as well', async () => {
    const { port } = await start()

    const { socket } = await connectWss(`wss://[::1]:${port}/`)
    socket.close()
  })

  it('passes ICE-TCP media on the same port to mediasoup and keeps WSS working', async () => {
    // Media must not wait for Nagle: it alone added >100 ms of round trip in a busy room (#33).
    const setNoDelay = vi.spyOn(Socket.prototype, 'setNoDelay')
    const received: Buffer[] = []
    const mediasoup = createNetServer((socket) => {
      socket.on('data', (chunk) => {
        received.push(chunk)
        socket.write('pong')
      })
    })
    await new Promise<void>((resolve) => {
      mediasoup.listen(0, '127.0.0.1', resolve)
    })
    const mediaPort = (mediasoup.address() as AddressInfo).port
    server = await startSignalingServer({
      port: await freePort(),
      key: certificate.key,
      cert: certificate.cert,
      mediaTcpPort: () => mediaPort,
    })

    // RFC 4571 frame: 16-bit length, then a STUN binding request header.
    const frame = Buffer.from([0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x21, 0x12, 0xa4, 0x42])
    const tcp = connect(server.port, '127.0.0.1')
    tcp.write(frame)
    const reply = await new Promise<string>((resolve) => {
      tcp.once('data', (d) => {
        resolve(d.toString('utf8'))
      })
    })
    tcp.destroy()

    expect(reply).toBe('pong')
    expect(Buffer.concat(received).equals(frame)).toBe(true)
    expect(setNoDelay.mock.calls.filter(([on]) => on === true).length).toBeGreaterThanOrEqual(2)
    setNoDelay.mockRestore()
    const { socket } = await connectWss(`wss://127.0.0.1:${server.port}/`)
    socket.close()
    mediasoup.close()
  })

  it('does not speak plain HTTP or WS', async () => {
    const { port } = await start()

    const response = await rawRequest(
      port,
      'GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n',
    )
    expect(response).not.toContain('101 Switching Protocols')
    expect(response).not.toContain('HTTP/1.1 200')

    const ws = new WebSocket(`ws://127.0.0.1:${port}/`)
    await expect(
      new Promise((resolve, reject) => {
        ws.once('open', resolve)
        ws.once('error', reject)
      }),
    ).rejects.toBeTruthy()
  })

  it('answers HTTPS requests without an upgrade with 426', async () => {
    const { port } = await start()

    const status = await new Promise<number | undefined>((resolve, reject) => {
      request({ host: '127.0.0.1', port, path: '/', rejectUnauthorized: false }, (res) => {
        res.resume()
        resolve(res.statusCode)
      })
        .on('error', reject)
        .end()
    })

    expect(status).toBe(426)
  })

  it('reports a busy port as port-in-use', async () => {
    const { port } = await start()

    const second = startSignalingServer({ port, key: certificate.key, cert: certificate.cert })

    await expect(second).rejects.toBeInstanceOf(SignalingServerStartError)
    await expect(second).rejects.toMatchObject({ reason: 'port-in-use' })
  })

  it('closes connected clients and frees the port on close', async () => {
    const running = await start()
    const { socket } = await connectWss(`wss://127.0.0.1:${running.port}/`)
    const closed = new Promise<number>((resolve) => {
      socket.once('close', (code) => {
        resolve(code)
      })
    })

    await running.close()
    server = null

    expect(await closed).toBe(1001)
    const reuse = createNetServer()
    await new Promise<void>((resolve, reject) => {
      reuse.once('error', reject)
      reuse.listen(running.port, resolve)
    })
    await new Promise<void>((resolve) => {
      reuse.close(() => {
        resolve()
      })
    })
  })
})
