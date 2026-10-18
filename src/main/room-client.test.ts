import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { Invite } from '@shared/invite'
import { AttemptLimiter, normalizeAddress } from '../host/attempt-limiter'
import { loadOrCreateCertificate, type HostCertificate } from '../host/certificate'
import { MediaServer } from '../host/media-server'
import { CHAT_BURST, Room } from '../host/room'
import { startSignalingServer, type SignalingServer } from '../host/server'
import type { RoomEvent } from '@shared/room'
import { joinRoom, pointCandidatesAt, probeRoom, type RoomConnection } from './room-client'

// Real host (TLS server + Room) and real client, over loopback.

let dir: string
let certificate: HostCertificate
let server: SignalingServer | null = null
let room: Room
let media: MediaServer | null = null
const connections: RoomConnection[] = []

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tolki-room-'))
  certificate = await loadOrCreateCertificate(dir)
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

afterEach(async () => {
  for (const c of connections.splice(0)) c.close()
  await server?.close()
  server = null
  media?.close()
  media = null
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

async function startHost(
  password: string,
  options: {
    handshakeTimeoutMs?: number
    withMedia?: boolean
    approval?: boolean
    organizerKey?: string
  } = {},
) {
  const { withMedia, approval, organizerKey, ...roomOptions } = options
  const port = await freePort()
  if (withMedia) media = await MediaServer.start({ port })
  room = new Room(
    {
      name: 'Вечерний созвон',
      password,
      fingerprint: certificate.fingerprint,
      ...(approval !== undefined ? { approval } : {}),
      ...(organizerKey !== undefined ? { organizerKey } : {}),
    },
    { limiter: new AttemptLimiter(), ...roomOptions, ...(media && { media }) },
  )
  server = await startSignalingServer({
    port,
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
  it('reports the room name, number of people and password flag, without joining', async () => {
    const invite = await startHost('secret')
    await enter(invite, 'Дима', 'secret')

    expect(await probeRoom(invite)).toEqual({
      status: 'live',
      room: { name: 'Вечерний созвон', peerCount: 1, hasPassword: true, approval: false },
    })
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

describe('when a joined room ends', () => {
  it('reports host-closed when the host closes the room', async () => {
    const invite = await startHost('')
    const connection = await joinRoom({ invite, name: 'Катя', password: undefined })
    connections.push(connection)
    const closed = new Promise((resolve) => {
      connection.onClosed(resolve)
    })

    room.close()

    expect(await closed).toBe('host-closed')
  })

  it('reports connection-lost when the host disappears without closing', async () => {
    const invite = await startHost('')
    const connection = await joinRoom({ invite, name: 'Катя', password: undefined })
    const closed = new Promise((resolve) => {
      connection.onClosed(resolve)
    })

    await server?.close()
    server = null

    expect(await closed).toBe('connection-lost')
  })

  it('stays silent when the user leaves', async () => {
    const invite = await startHost('')
    const connection = await joinRoom({ invite, name: 'Катя', password: undefined })
    let called = false
    connection.onClosed(() => {
      called = true
    })

    connection.close()
    await new Promise((r) => setTimeout(r, 200))

    expect(called).toBe(false)
  })
})

describe('media requests and room events', () => {
  it('passes requests to the host and points ICE candidates at the invite’s host', async () => {
    const invite = await startHost('', { withMedia: true })
    const connection = await joinRoom({ invite, name: 'Катя', password: undefined })
    connections.push(connection)
    expect(connection.result).toMatchObject({ ok: true })
    if (!connection.result.ok) return
    expect(JSON.stringify(connection.result.routerRtpCapabilities)).toContain('audio/opus')

    const response = await connection.request({ method: 'createTransport', direction: 'recv' })

    expect(response.ok).toBe(true)
    const data = (response as { data: { iceCandidates: { ip: string; address: string }[] } }).data
    expect(data.iceCandidates.length).toBeGreaterThan(0)
    for (const candidate of data.iceCandidates) {
      expect(candidate).toMatchObject({ ip: '127.0.0.1', address: '127.0.0.1' })
    }
    expect(await connection.request({ method: 'resumeConsumer', consumerId: 'x' })).toEqual({
      ok: false,
      error: 'unknown consumer',
    })
  })

  it('reports host errors and a closed connection as failed responses', async () => {
    const invite = await startHost('')
    const connection = await joinRoom({ invite, name: 'Катя', password: undefined })

    expect(await connection.request({ method: 'createTransport', direction: 'send' })).toEqual({
      ok: false,
      error: 'media is not available',
    })
    connection.close()
    expect(await connection.request({ method: 'createTransport', direction: 'send' })).toEqual({
      ok: false,
      error: 'disconnected',
    })
  })

  it('delivers room events, including those that came right after welcome', async () => {
    const invite = await startHost('')
    const first = await joinRoom({ invite, name: 'Катя', password: undefined })
    connections.push(first)
    const second = await joinRoom({ invite, name: 'Миша', password: undefined })
    connections.push(second)
    await new Promise((r) => setTimeout(r, 100))

    const seen: string[] = []
    first.onEvent((event) => seen.push(event.type))
    expect(seen).toEqual(['peer-joined'])

    second.close()
    await expect.poll(() => seen).toEqual(['peer-joined', 'peer-left'])
  })
})

describe('pointCandidatesAt', () => {
  it('replaces candidate addresses and leaves other data alone', () => {
    expect(
      pointCandidatesAt({ id: 't', iceCandidates: [{ ip: '::', address: '::', port: 1 }] }, 'h'),
    ).toEqual({ id: 't', iceCandidates: [{ ip: 'h', address: 'h', port: 1 }] })
    expect(pointCandidatesAt({ id: 't' }, 'h')).toEqual({ id: 't' })
    expect(pointCandidatesAt(null, 'h')).toBeNull()
    expect(pointCandidatesAt({ iceCandidates: 'x' }, 'h')).toEqual({ iceCandidates: 'x' })
  })
})

describe('the organizer’s rights (#42)', () => {
  const KEY = 'k'.repeat(32)

  /** The organizer in their own room, with the events they get. */
  async function organizer(invite: Invite) {
    const connection = await joinRoom({
      invite,
      name: 'Организатор',
      password: undefined,
      organizerKey: KEY,
    })
    connections.push(connection)
    const events: RoomEvent[] = []
    connection.onEvent((event) => events.push(event))
    return { connection, events }
  }

  it('knows the organizer by the key, nobody else', async () => {
    const invite = await startHost('', { organizerKey: KEY })
    const own = await organizer(invite)
    expect(own.connection.result).toMatchObject({ ok: true, organizer: true })
    const guest = await joinRoom({
      invite,
      name: 'Катя',
      password: undefined,
      organizerKey: 'x'.repeat(32),
    })
    connections.push(guest)
    expect(guest.result).toMatchObject({ ok: true, organizer: false })
  })

  it('marks the organizer for everyone, and tells everyone the organizer’s upload (#87)', async () => {
    const invite = await startHost('', { organizerKey: KEY })
    const own = await organizer(invite)
    const katya = await joinRoom({ invite, name: 'Катя', password: undefined })
    connections.push(katya)
    const katyaSees: RoomEvent[] = []
    katya.onEvent((event) => katyaSees.push(event))
    // Already inside: the organizer is marked in the list Katya gets.
    expect(katya.result.ok && katya.result.peers).toEqual([
      expect.objectContaining({ name: 'Организатор', organizer: true }),
    ])
    // Katya herself is not.
    await expect
      .poll(() => own.events.find((e) => e.type === 'peer-joined'))
      .toMatchObject({
        peer: { name: 'Катя' },
      })
    const joined = own.events.find((e) => e.type === 'peer-joined')
    expect(joined?.type === 'peer-joined' && joined.peer.organizer).toBeFalsy()

    room.setUpload('measured', 40)
    const stats = (events: RoomEvent[]) => events.filter((e) => e.type === 'host-stats')
    await expect
      .poll(() => stats(katyaSees))
      .toEqual([
        { type: 'host-stats', uploadMbps: 40, participants: 15, screen: '720p', measured: true },
      ])
    expect(stats(own.events)).toHaveLength(1)
    // The call's statistics below the measurement change nothing.
    room.setUpload('live', 12)
    await new Promise((r) => setTimeout(r, 50))
    expect(stats(katyaSees)).toHaveLength(1)

    // Someone coming later hears it right away.
    const misha = await joinRoom({ invite, name: 'Миша', password: undefined })
    connections.push(misha)
    const mishaSees: RoomEvent[] = []
    misha.onEvent((event) => mishaSees.push(event))
    await expect.poll(() => stats(mishaSees)).toHaveLength(1)
  })

  it('makes a guest wait until the organizer lets them in, or not', async () => {
    const invite = await startHost('', { organizerKey: KEY, approval: true })
    const own = await organizer(invite)
    expect(own.connection.result).toMatchObject({ ok: true, approval: true })
    expect(await probeRoom(invite)).toMatchObject({ room: { approval: true } })

    let waited = false
    const joining = joinRoom({
      invite,
      name: 'Катя',
      password: undefined,
      onWaiting: () => (waited = true),
    })
    await expect.poll(() => own.events.find((e) => e.type === 'join-request')).toBeTruthy()
    const request = own.events.find((e) => e.type === 'join-request')
    expect(request).toMatchObject({ name: 'Катя' })
    expect(waited).toBe(true)
    // Not inside yet: not counted, not among the peers.
    expect(room.peers.map((p) => p.name)).toEqual(['Организатор'])

    const requestId = request?.type === 'join-request' ? request.requestId : ''
    expect(await own.connection.request({ method: 'answerJoin', requestId, admit: true })).toEqual({
      ok: true,
      data: {},
    })
    const katya = await joining
    connections.push(katya)
    expect(katya.result).toMatchObject({ ok: true, organizer: false })

    // Refused: JOIN_REFUSED.
    const refusedJoin = joinRoom({ invite, name: 'Миша', password: undefined })
    await expect.poll(() => own.events.filter((e) => e.type === 'join-request').length).toBe(2)
    const second = own.events.filter((e) => e.type === 'join-request')[1]
    await own.connection.request({
      method: 'answerJoin',
      requestId: second?.type === 'join-request' ? second.requestId : '',
      admit: false,
    })
    expect((await refusedJoin).result).toEqual({ ok: false, error: 'JOIN_REFUSED' })
  })

  it('lets the one waiting stop waiting; the organizer learns they left', async () => {
    const invite = await startHost('', { organizerKey: KEY, approval: true })
    const own = await organizer(invite)
    const stop = new AbortController()
    const joining = joinRoom({ invite, name: 'Катя', password: undefined, signal: stop.signal })
    await expect.poll(() => own.events.some((e) => e.type === 'join-request')).toBe(true)
    stop.abort()
    expect((await joining).result).toEqual({ ok: false, error: 'cancelled' })
    await expect.poll(() => own.events.some((e) => e.type === 'join-request-gone')).toBe(true)
  })

  it('lets everyone waiting in when approval is turned off; only the organizer may do that', async () => {
    const invite = await startHost('', { organizerKey: KEY, approval: true })
    const own = await organizer(invite)
    const joining = joinRoom({ invite, name: 'Катя', password: undefined })
    await expect.poll(() => own.events.some((e) => e.type === 'join-request')).toBe(true)

    expect(await own.connection.request({ method: 'setApproval', enabled: false })).toEqual({
      ok: true,
      data: {},
    })
    const katya = await joining
    connections.push(katya)
    expect(katya.result.ok).toBe(true)
    expect(own.events).toContainEqual({ type: 'approval-changed', enabled: false })
    expect(await katya.request({ method: 'setApproval', enabled: true })).toEqual({
      ok: false,
      error: 'not the organizer',
    })
  })

  it('removes a participant: they learn it and do not come back by themselves', async () => {
    const invite = await startHost('', { organizerKey: KEY })
    const own = await organizer(invite)
    const katya = await joinRoom({ invite, name: 'Катя', password: undefined })
    connections.push(katya)
    const reason = new Promise((resolve) => {
      katya.onClosed(resolve)
    })
    const katyaId = katya.result.ok ? katya.result.peerId : ''
    expect(
      await katya.request({
        method: 'removePeer',
        peerId: own.connection.result.ok ? own.connection.result.peerId : '',
      }),
    ).toEqual({
      ok: false,
      error: 'not the organizer',
    })
    expect(await own.connection.request({ method: 'removePeer', peerId: katyaId })).toEqual({
      ok: true,
      data: {},
    })
    expect(await reason).toBe('removed')
    await expect.poll(() => room.peers.map((p) => p.name)).toEqual(['Организатор'])
  })

  it('takes a dropped participant back without waiting, but not a removed one', async () => {
    const invite = await startHost('', { organizerKey: KEY, approval: false })
    const own = await organizer(invite)
    const katya = await joinRoom({ invite, name: 'Катя', password: undefined })
    const token = katya.rejoinToken
    expect(token).toBeTruthy()
    await own.connection.request({ method: 'setApproval', enabled: true })
    katya.close()
    await expect.poll(() => room.peers.length).toBe(1)

    const back = await joinRoom({
      invite,
      name: 'Катя',
      password: undefined,
      rejoinToken: token,
      timeoutMs: 3000,
    })
    connections.push(back)
    expect(back.result.ok).toBe(true)

    // A removed participant's token does not bring them back: they wait like anyone.
    expect(
      await own.connection.request({
        method: 'removePeer',
        peerId: back.result.ok ? back.result.peerId : '',
      }),
    ).toEqual({ ok: true, data: {} })
    await expect.poll(() => room.peers.length).toBe(1)
    let waited = false
    const stop = new AbortController()
    const again = joinRoom({
      invite,
      name: 'Катя',
      password: undefined,
      rejoinToken: back.rejoinToken,
      onWaiting: () => (waited = true),
      signal: stop.signal,
    })
    await expect.poll(() => waited).toBe(true)
    stop.abort()
    expect((await again).result).toEqual({ ok: false, error: 'cancelled' })
  })
})

describe('the chat (#45)', () => {
  it('passes a message to everyone in the room, the sender too, and keeps nothing', async () => {
    const invite = await startHost('')
    const katya = await joinRoom({ invite, name: 'Катя', password: undefined })
    connections.push(katya)
    const misha = await joinRoom({ invite, name: 'Миша', password: undefined })
    connections.push(misha)
    const katyaSees: RoomEvent[] = []
    const mishaSees: RoomEvent[] = []
    katya.onEvent((event) => katyaSees.push(event))
    misha.onEvent((event) => mishaSees.push(event))
    const katyaId = katya.result.ok ? katya.result.peerId : ''

    expect(
      await katya.request({ method: 'sendChat', text: '  смотрите https://example.com  ' }),
    ).toEqual({ ok: true, data: {} })
    const chat = (events: RoomEvent[]) => events.filter((e) => e.type === 'chat')
    await expect.poll(() => chat(mishaSees).length).toBe(1)
    expect(chat(mishaSees)[0]).toMatchObject({
      peerId: katyaId,
      text: 'смотрите https://example.com',
    })
    await expect.poll(() => chat(katyaSees).length).toBe(1)

    // Whoever comes later sees nothing of it.
    const late = await joinRoom({ invite, name: 'Оля', password: undefined })
    connections.push(late)
    const lateSees: RoomEvent[] = []
    late.onEvent((event) => lateSees.push(event))
    await new Promise((r) => setTimeout(r, 100))
    expect(chat(lateSees)).toEqual([])
  })

  it('refuses too many messages at once', async () => {
    const invite = await startHost('')
    const katya = await joinRoom({ invite, name: 'Катя', password: undefined })
    connections.push(katya)
    const answers = []
    for (let i = 0; i <= CHAT_BURST; i++) {
      answers.push(await katya.request({ method: 'sendChat', text: `сообщение ${i}` }))
    }
    expect(answers.slice(0, CHAT_BURST).every((a) => a.ok)).toBe(true)
    expect(answers[CHAT_BURST]).toEqual({ ok: false, error: 'too many messages' })
  })
})
