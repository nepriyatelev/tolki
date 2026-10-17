import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { Invite } from '@shared/invite'
import { AttemptLimiter, normalizeAddress } from '../host/attempt-limiter'
import { loadOrCreateCertificate, type HostCertificate } from '../host/certificate'
import { Room } from '../host/room'
import { startSignalingServer, type SignalingServer } from '../host/server'
import { joinRoom, probeRoom, type RoomConnection } from './room-client'

// Real host (TLS server + Room) and real client, over loopback.

let dir: string
let certificate: HostCertificate
let server: SignalingServer | null = null
let room: Room
const connections: RoomConnection[] = []

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ratatosk-room-'))
  certificate = await loadOrCreateCertificate(dir)
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

afterEach(async () => {
  for (const c of connections.splice(0)) c.close()
  await server?.close()
  server = null
})

async function freePort(): Promise<number> {
  const probe = createServer()
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

async function startHost(password: string, options: { handshakeTimeoutMs?: number } = {}) {
  room = new Room(
    { name: 'Вечерний созвон', password, fingerprint: certificate.fingerprint },
    { limiter: new AttemptLimiter(), ...options },
  )
  server = await startSignalingServer({
    port: await freePort(),
    key: certificate.key,
    cert: certificate.cert,
    onConnection: (socket, address) => {
      room.accept(socket, normalizeAddress(address))
    },
  })
  const invite: Invite = {
    host: '127.0.0.1',
    hostKind: 'ipv4',
    port: server.port,
    roomId: 'vecherniy',
    fingerprint: certificate.fingerprint,
  }
  return invite
}

async function enter(invite: Invite, name: string, password?: string) {
  const connection = await joinRoom({ invite, name, password, timeoutMs: 3000 })
  connections.push(connection)
  return connection.result
}

describe('joining a room', () => {
  it('enters a room without a password', async () => {
    const invite = await startHost('')

    const result = await enter(invite, 'Алексей')

    expect(result).toMatchObject({
      ok: true,
      peers: [],
      room: { name: 'Вечерний созвон', peerCount: 0, hasPassword: false },
    })
    expect(room.peers.map((p) => p.name)).toEqual(['Алексей'])
  })

  it('enters with the right password; later peers see who is inside', async () => {
    const invite = await startHost('лиса-маяк-42')

    const first = await enter(invite, 'Дима', 'лиса-маяк-42')
    const second = await enter(invite, 'Катя', 'лиса-маяк-42')

    expect(first.ok).toBe(true)
    expect(second).toMatchObject({ ok: true, room: { peerCount: 1 }, peers: [{ name: 'Дима' }] })
  })

  it('refuses a wrong password with WRONG_PASSWORD', async () => {
    const invite = await startHost('secret')

    expect(await enter(invite, 'Миша', 'guess')).toEqual({ ok: false, error: 'WRONG_PASSWORD' })
    expect(room.peers).toHaveLength(0)
  })

  it('asks for a password without spending an attempt', async () => {
    const invite = await startHost('secret')

    for (let i = 0; i < 6; i++) {
      expect(await enter(invite, 'Миша')).toMatchObject({
        ok: false,
        error: 'password-required',
        room: { hasPassword: true },
      })
    }
    expect((await enter(invite, 'Миша', 'secret')).ok).toBe(true)
  })

  it('blocks after 5 wrong passwords a minute, even the right one', async () => {
    const invite = await startHost('secret')

    for (let i = 0; i < 5; i++) {
      expect(await enter(invite, 'Миша', `guess-${i}`)).toMatchObject({ error: 'WRONG_PASSWORD' })
    }

    expect(await enter(invite, 'Миша', 'guess-6')).toEqual({
      ok: false,
      error: 'TOO_MANY_ATTEMPTS',
    })
    expect(await enter(invite, 'Миша', 'secret')).toEqual({ ok: false, error: 'TOO_MANY_ATTEMPTS' })
  })

  it('never sends anything to a host whose certificate does not match the link', async () => {
    const invite = await startHost('secret')
    let received = 0
    const original = room.accept.bind(room)
    room.accept = (socket, address) => {
      socket.on('message', () => received++)
      original(socket, address)
    }

    const result = await enter({ ...invite, fingerprint: 'A'.repeat(42) + 'E' }, 'Миша', 'secret')

    expect(result).toEqual({ ok: false, error: 'certificate-mismatch' })
    await new Promise((r) => setTimeout(r, 100))
    expect(received).toBe(0)
  })

  it('reports an unreachable host', async () => {
    const invite = await startHost('')
    const port = await freePort()

    expect(await enter({ ...invite, port }, 'Миша')).toEqual({ ok: false, error: 'unreachable' })
  })

  it('removes a peer when it disconnects', async () => {
    const invite = await startHost('')
    const connection = await joinRoom({ invite, name: 'Дима', password: undefined })

    connection.close()

    await expect.poll(() => room.peers.length).toBe(0)
  })
})

describe('host protocol checks', () => {
  async function rawClient(invite: Invite, messages: string[]): Promise<string[]> {
    const socket = new WebSocket(`wss://127.0.0.1:${invite.port}/`, { rejectUnauthorized: false })
    const received: string[] = []
    await new Promise<void>((resolve) => {
      socket.on('open', () => {
        for (const m of messages) socket.send(m)
      })
      socket.on('message', (data: Buffer) => received.push(data.toString('utf8')))
      socket.on('close', () => {
        resolve()
      })
    })
    return received
  }

  it('rejects another protocol version with VERSION_MISMATCH', async () => {
    const invite = await startHost('')

    const received = await rawClient(invite, [
      JSON.stringify({ type: 'hello', protocolVersion: 2 }),
    ])

    expect(received).toEqual([JSON.stringify({ type: 'error', code: 'VERSION_MISMATCH' })])
  })

  it.each([
    ['not JSON', 'hello'],
    ['unknown message', JSON.stringify({ type: 'join' })],
    ['auth before hello', JSON.stringify({ type: 'auth', name: 'x', hmac: null })],
  ])('rejects %s with BAD_REQUEST', async (_case, message) => {
    const invite = await startHost('')

    expect(await rawClient(invite, [message])).toEqual([
      JSON.stringify({ type: 'error', code: 'BAD_REQUEST' }),
    ])
  })

  it('rejects names with control characters', async () => {
    const invite = await startHost('')
    const hello = JSON.stringify({ type: 'hello', protocolVersion: 1 })
    const auth = JSON.stringify({ type: 'auth', name: 'bad\nname', hmac: null })

    const received = await rawClient(invite, [hello, auth])

    expect(received.at(-1)).toBe(JSON.stringify({ type: 'error', code: 'BAD_REQUEST' }))
  })

  it('drops a connection that does not finish the handshake in time', async () => {
    const invite = await startHost('', { handshakeTimeoutMs: 200 })

    const received = await rawClient(invite, [])

    expect(received).toEqual([])
  })
})

describe('probeRoom (recent rooms status)', () => {
  it('reports a running room with the number of people, without joining', async () => {
    const invite = await startHost('secret')
    await enter(invite, 'Дима', 'secret')

    expect(await probeRoom(invite)).toEqual({ status: 'live', peerCount: 1 })
    expect(room.peers.map((p) => p.name)).toEqual(['Дима'])
  })

  it('reports an offline host', async () => {
    const invite = await startHost('')

    expect(await probeRoom({ ...invite, port: await freePort() }, 1000)).toEqual({
      status: 'offline',
    })
  })

  it('reports a changed certificate and sends nothing', async () => {
    const invite = await startHost('')

    expect(await probeRoom({ ...invite, fingerprint: 'A'.repeat(42) + 'E' })).toEqual({
      status: 'certificate-changed',
    })
  })
})
