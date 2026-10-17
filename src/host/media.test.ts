import { createSocket } from 'node:dgram'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as mediasoup from 'mediasoup'
import type { types } from 'mediasoup'
import { WebSocket } from 'ws'
import type { HostMessage, MediaRequest } from '@shared/signaling'
import { loadOrCreateCertificate, type HostCertificate } from './certificate'
import { MediaServer, MediaServerStartError } from './media-server'
import { Room } from './room'
import { startSignalingServer, type SignalingServer } from './server'

// Real mediasoup worker, real signalling server, and plain WebSocket clients speaking the protocol.

let dir: string
let certificate: HostCertificate
let server: SignalingServer | null = null
let media: MediaServer | null = null
const clients: Client[] = []

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ratatosk-media-'))
  certificate = await loadOrCreateCertificate(dir)
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

afterEach(async () => {
  for (const client of clients.splice(0)) client.socket.close()
  await server?.close()
  server = null
  media?.close()
  media = null
})

/** A port free for both TCP and UDP (a closed worker may still hold its UDP port briefly). */
async function freePort(): Promise<number> {
  for (;;) {
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
    const udp = createSocket('udp6')
    const free = await new Promise<boolean>((resolve) => {
      udp.once('error', () => {
        resolve(false)
      })
      udp.bind(port, () => {
        resolve(true)
      })
    })
    udp.close()
    if (free) return port
  }
}

async function startRoom(options: { media?: boolean; maxPeers?: number } = {}) {
  const port = await freePort()
  if (options.media !== false) media = await MediaServer.start({ port })
  const sfu = media ?? undefined
  const room = new Room(
    { name: 'Тест', password: '', fingerprint: certificate.fingerprint },
    {
      ...(sfu && { media: sfu }),
      ...(options.maxPeers !== undefined && { maxPeers: options.maxPeers }),
    },
  )
  server = await startSignalingServer({
    port,
    key: certificate.key,
    cert: certificate.cert,
    onConnection: (socket, address) => {
      room.accept(socket, address ?? '')
    },
    mediaTcpPort: () => media?.tcpPort,
  })
  return { port, room }
}

class Client {
  readonly messages: HostMessage[] = []
  readonly #waiters: (() => void)[] = []
  #nextId = 0

  constructor(readonly socket: WebSocket) {
    socket.on('message', (data) => {
      this.messages.push(JSON.parse((data as Buffer).toString('utf8')) as HostMessage)
      for (const wake of this.#waiters.splice(0)) wake()
    })
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message))
  }

  async next<T extends HostMessage['type']>(
    type: T,
    match: (m: Extract<HostMessage, { type: T }>) => boolean = () => true,
  ): Promise<Extract<HostMessage, { type: T }>> {
    for (;;) {
      const index = this.messages.findIndex(
        (m) => m.type === type && match(m as Extract<HostMessage, { type: T }>),
      )
      if (index >= 0) return this.messages.splice(index, 1)[0] as Extract<HostMessage, { type: T }>
      await new Promise<void>((resolve) => this.#waiters.push(resolve))
    }
  }

  async request(request: MediaRequest): Promise<{ data?: unknown; error?: string | undefined }> {
    const id = this.#nextId++
    this.send({ type: 'request', id, request })
    return this.next('response', (m) => m.id === id)
  }

  async ok<T>(request: MediaRequest): Promise<T> {
    const response = await this.request(request)
    if (response.error !== undefined) throw new Error(response.error)
    return response.data as T
  }
}

async function connect(port: number, name: string): Promise<Client> {
  const socket = new WebSocket(`wss://127.0.0.1:${port}`, { rejectUnauthorized: false })
  const client = new Client(socket)
  clients.push(client)
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  client.send({ type: 'hello', protocolVersion: 1 })
  await client.next('challenge')
  client.send({ type: 'auth', name, hmac: null })
  return client
}

const DTLS = {
  role: 'client',
  fingerprints: [{ algorithm: 'sha-256', value: Array(32).fill('AB').join(':') }],
}

const OPUS_SEND = {
  mid: '0',
  codecs: [
    {
      mimeType: 'audio/opus',
      payloadType: 111,
      clockRate: 48000,
      channels: 2,
      parameters: { useinbandfec: 1 },
      rtcpFeedback: [],
    },
  ],
  headerExtensions: [],
  encodings: [{ ssrc: 11111111 }],
  rtcp: { cname: 'test' },
}

const VP8_SCREEN = {
  mid: '1',
  codecs: [
    { mimeType: 'video/VP8', payloadType: 96, clockRate: 90000, parameters: {}, rtcpFeedback: [] },
  ],
  headerExtensions: [
    { uri: 'urn:ietf:params:rtp-hdrext:sdes:mid', id: 1 },
    { uri: 'urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id', id: 2 },
  ],
  encodings: [
    { rid: 'low', scaleResolutionDownBy: 3, maxBitrate: 500000 },
    { rid: 'high', scaleResolutionDownBy: 1, maxBitrate: 2800000 },
  ],
  rtcp: { cname: 'screen' },
}

interface Transport {
  id: string
  iceCandidates: { protocol: string; port: number }[]
}

async function startSending(client: Client) {
  const transport = await client.ok<Transport>({ method: 'createTransport', direction: 'send' })
  await client.ok({ method: 'connectTransport', transportId: transport.id, dtlsParameters: DTLS })
  const producer = await client.ok<{ id: string }>({
    method: 'produce',
    transportId: transport.id,
    kind: 'audio',
    rtpParameters: OPUS_SEND,
  })
  return { transport, producer }
}

/** Every consumer the host creates, to look at what it actually forwards. */
function watchConsumers(): types.Consumer[] {
  const consumers: types.Consumer[] = []
  mediasoup.observer.once('newworker', (worker) => {
    worker.observer.on('newrouter', (router) => {
      router.observer.on('newtransport', (transport) => {
        transport.observer.on('newconsumer', (consumer) => consumers.push(consumer))
      })
    })
  })
  return consumers
}

describe('media on the host (mediasoup)', () => {
  it('welcomes with the router capabilities and announces candidates on the public port', async () => {
    const { port } = await startRoom()
    const alice = await connect(port, 'Алиса')

    const welcome = await alice.next('welcome')
    // Opus with FEC and DTX, mono (PLAN #25); H.264 before VP8 for the screen (PLAN #27).
    const codecs = (welcome.routerRtpCapabilities as { codecs: { mimeType: string }[] }).codecs
    expect(codecs[0]).toMatchObject({
      mimeType: 'audio/opus',
      clockRate: 48000,
      parameters: { useinbandfec: 1, usedtx: 1, stereo: 0 },
    })
    const video = codecs
      .map((c) => c.mimeType)
      .filter((m) => m.startsWith('video/') && !m.endsWith('rtx'))
    expect(video).toEqual(['video/H264', 'video/VP8'])
    expect(welcome.screenMode).toBe('auto')

    const transport = await alice.ok<Transport>({ method: 'createTransport', direction: 'send' })
    expect(transport.iceCandidates.map((c) => [c.protocol, c.port]).sort()).toEqual([
      ['tcp', port],
      ['udp', port],
    ])

    if (media) media.publicUdpPort = 51000
    const recv = await alice.ok<Transport>({ method: 'createTransport', direction: 'recv' })
    expect(recv.iceCandidates.find((c) => c.protocol === 'udp')?.port).toBe(51000)
  })

  it('forwards one participant’s voice to another: produce → new-producer → consume → resume', async () => {
    const { port, room } = await startRoom()
    const alice = await connect(port, 'Алиса')
    await alice.next('welcome')
    const bob = await connect(port, 'Боб')
    await bob.next('welcome')
    expect((await alice.next('peer-joined')).peer.name).toBe('Боб')

    const { producer } = await startSending(alice)
    const announced = await bob.next('new-producer')
    expect(announced).toMatchObject({ producerId: producer.id, kind: 'audio' })

    const caps = (await connect(port, 'Вера').then((c) => c.next('welcome'))).routerRtpCapabilities
    const recv = await bob.ok<Transport>({ method: 'createTransport', direction: 'recv' })
    await bob.ok({ method: 'connectTransport', transportId: recv.id, dtlsParameters: DTLS })
    const consumer = await bob.ok<{ id: string; producerId: string; kind: string }>({
      method: 'consume',
      transportId: recv.id,
      producerId: producer.id,
      rtpCapabilities: caps,
    })
    expect(consumer).toMatchObject({ producerId: producer.id, kind: 'audio' })
    expect(await bob.ok({ method: 'resumeConsumer', consumerId: consumer.id })).toEqual({})
    expect(room.transports).toHaveLength(2)

    // Alice leaves: Bob's consumer ends and everyone learns she is gone.
    alice.socket.close()
    expect(await bob.next('consumer-closed')).toMatchObject({ consumerId: consumer.id })
    expect(await bob.next('peer-left')).toBeTruthy()
  })

  it('tells a newcomer about voices that are already on', async () => {
    const { port } = await startRoom()
    const alice = await connect(port, 'Алиса')
    await alice.next('welcome')
    const { producer } = await startSending(alice)

    const bob = await connect(port, 'Боб')
    await bob.next('welcome')
    expect(await bob.next('new-producer')).toMatchObject({ producerId: producer.id })
  })

  it('refuses requests that make no sense', async () => {
    const { port } = await startRoom()
    const alice = await connect(port, 'Алиса')
    const { routerRtpCapabilities: caps } = await alice.next('welcome')
    const { transport, producer } = await startSending(alice)

    expect(
      (
        await alice.request({
          method: 'consume',
          transportId: transport.id,
          producerId: producer.id,
          rtpCapabilities: caps,
        })
      ).error,
    ).toBe('not a recv transport')
    const recv = await alice.ok<Transport>({ method: 'createTransport', direction: 'recv' })
    expect(
      (
        await alice.request({
          method: 'consume',
          transportId: recv.id,
          producerId: producer.id,
          rtpCapabilities: caps,
        })
      ).error,
    ).toBe('unknown producer')
    expect((await alice.request({ method: 'createTransport', direction: 'recv' })).error).toBe(
      'too many transports',
    )
    expect((await alice.request({ method: 'resumeConsumer', consumerId: 'nope' })).error).toBe(
      'unknown consumer',
    )
    expect(
      (
        await alice.request({
          method: 'produce',
          transportId: transport.id,
          kind: 'audio',
          rtpParameters: { broken: true },
        })
      ).error,
    ).toBeTruthy()
  })

  it('mutes: pauses the producer, tells everyone, and newcomers learn it from welcome', async () => {
    const { port } = await startRoom()
    const alice = await connect(port, 'Алиса')
    const { peerId: aliceId } = await alice.next('welcome')
    const bob = await connect(port, 'Боб')
    await bob.next('welcome')
    const { producer } = await startSending(alice)

    expect(await alice.ok({ method: 'pauseProducer', producerId: producer.id })).toEqual({})
    expect(await bob.next('peer-muted')).toMatchObject({ peerId: aliceId, muted: true })
    const vera = await connect(port, 'Вера')
    expect((await vera.next('welcome')).mutedPeers).toEqual([aliceId])

    await alice.ok({ method: 'resumeProducer', producerId: producer.id })
    expect(await bob.next('peer-muted')).toMatchObject({ peerId: aliceId, muted: false })
    // Someone else's producer cannot be paused.
    expect((await bob.request({ method: 'pauseProducer', producerId: producer.id })).error).toBe(
      'unknown producer',
    )
  })

  it('does not let a participant pile up work on the host', async () => {
    const { port } = await startRoom()
    const alice = await connect(port, 'Алиса')
    await alice.next('welcome')
    const { producer } = await startSending(alice)
    const bob = await connect(port, 'Боб')
    const { routerRtpCapabilities: caps } = await bob.next('welcome')
    const recv = await bob.ok<Transport>({ method: 'createTransport', direction: 'recv' })
    const consume = () =>
      bob.request({
        method: 'consume',
        transportId: recv.id,
        producerId: producer.id,
        rtpCapabilities: caps,
      })

    expect((await consume()).error).toBeUndefined()
    expect((await consume()).error).toBe('already consuming')

    // A burst of requests: those beyond the in-flight limit are refused, nothing crashes.
    // Each one waits for the mediasoup worker, so they are all in flight at once.
    const burst = await Promise.all(
      Array.from({ length: 40 }, () =>
        bob.request({ method: 'connectTransport', transportId: recv.id, dtlsParameters: DTLS }),
      ),
    )
    expect(burst.some((r) => r.error === 'too many requests')).toBe(true)
  })

  it('takes a simulcast screen and closes it on request (#27)', async () => {
    const consumers = watchConsumers()
    const { port } = await startRoom()
    const alice = await connect(port, 'Алиса')
    await alice.next('welcome')
    const bob = await connect(port, 'Боб')
    const { routerRtpCapabilities: caps } = await bob.next('welcome')
    const send = await alice.ok<Transport>({ method: 'createTransport', direction: 'send' })
    await alice.ok({ method: 'connectTransport', transportId: send.id, dtlsParameters: DTLS })

    const screenProducer = await alice.ok<{ id: string }>({
      method: 'produce',
      transportId: send.id,
      kind: 'video',
      rtpParameters: {
        mid: '1',
        codecs: [
          {
            mimeType: 'video/VP8',
            payloadType: 96,
            clockRate: 90000,
            parameters: {},
            rtcpFeedback: [],
          },
        ],
        headerExtensions: [
          { uri: 'urn:ietf:params:rtp-hdrext:sdes:mid', id: 1 },
          { uri: 'urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id', id: 2 },
        ],
        encodings: [
          { rid: 'low', scaleResolutionDownBy: 3, maxBitrate: 500000 },
          { rid: 'high', scaleResolutionDownBy: 1, maxBitrate: 2800000 },
        ],
        rtcp: { cname: 'screen' },
      },
    })
    expect(await bob.next('new-producer')).toMatchObject({
      producerId: screenProducer.id,
      kind: 'video',
    })

    const recv = await bob.ok<Transport>({ method: 'createTransport', direction: 'recv' })
    const consumer = await bob.ok<{ id: string; kind: string }>({
      method: 'consume',
      transportId: recv.id,
      producerId: screenProducer.id,
      rtpCapabilities: caps,
    })
    expect(consumer.kind).toBe('video')

    // The viewer picks the layer by size and pauses it while hidden (#28).
    await bob.ok({ method: 'resumeConsumer', consumerId: consumer.id })
    expect(
      await bob.ok({ method: 'setPreferredLayers', consumerId: consumer.id, spatialLayer: 0 }),
    ).toEqual({})
    const hostSide = consumers.find((c) => c.id === consumer.id)
    expect(hostSide?.preferredLayers).toMatchObject({ spatialLayer: 0 })
    expect(hostSide?.paused).toBe(false)
    await bob.ok({ method: 'pauseConsumer', consumerId: consumer.id })
    expect(hostSide?.paused).toBe(true)
    await bob.ok({ method: 'resumeConsumer', consumerId: consumer.id })
    expect(hostSide?.paused).toBe(false)
    expect(
      (await bob.request({ method: 'setPreferredLayers', consumerId: 'nope', spatialLayer: 1 }))
        .error,
    ).toBe('unknown consumer')

    expect(await alice.ok({ method: 'closeProducer', producerId: screenProducer.id })).toEqual({})
    expect(await bob.next('consumer-closed')).toMatchObject({ consumerId: consumer.id })
    expect(
      (await alice.request({ method: 'closeProducer', producerId: screenProducer.id })).error,
    ).toBe('unknown producer')
  })

  it('tells everyone the room’s screen mode', async () => {
    const port = await freePort()
    media = await MediaServer.start({ port })
    const room = new Room(
      { name: 'Игры', password: '', fingerprint: certificate.fingerprint, screenMode: 'motion' },
      { media },
    )
    server = await startSignalingServer({
      port,
      key: certificate.key,
      cert: certificate.cert,
      onConnection: (socket, address) => {
        room.accept(socket, address ?? '')
      },
    })
    const alice = await connect(port, 'Алиса')
    expect((await alice.next('welcome')).screenMode).toBe('motion')
  })

  it('reports a busy UDP port', async () => {
    const port = await freePort()
    media = await MediaServer.start({ port })
    await expect(MediaServer.start({ port })).rejects.toMatchObject({
      constructor: MediaServerStartError,
      reason: 'port-in-use',
    })
  })
})

describe('forwarding only the loudest voices (#21)', () => {
  it('with 15 people talking, each receives at most 3 voices at once', async () => {
    const consumers = watchConsumers()
    const { port } = await startRoom()
    const people: { client: Client; producerId: string; caps: Record<string, unknown> }[] = []
    for (let i = 0; i < 15; i++) {
      const client = await connect(port, `Гость ${i}`)
      const { routerRtpCapabilities: caps } = await client.next('welcome')
      const { producer } = await startSending(client)
      people.push({ client, producerId: producer.id, caps })
    }

    const received = new Map<Client, string[]>()
    for (const { client, caps } of people) {
      const recv = await client.ok<Transport>({ method: 'createTransport', direction: 'recv' })
      const ids: string[] = []
      for (const other of people) {
        if (other.client === client) continue
        const consumer = await client.ok<{ id: string }>({
          method: 'consume',
          transportId: recv.id,
          producerId: other.producerId,
          rtpCapabilities: caps,
        })
        await client.ok({ method: 'resumeConsumer', consumerId: consumer.id })
        ids.push(consumer.id)
      }
      received.set(client, ids)
    }

    const running = (client: Client) =>
      consumers.filter((c) => received.get(client)?.includes(c.id) && !c.paused).length
    expect(consumers).toHaveLength(15 * 14)
    for (const { client } of people) expect(running(client)).toBeLessThanOrEqual(3)

    // A forwarded voice leaves: its slot goes to someone else, still three at most.
    const listener = people[14]?.client
    if (!listener) throw new Error('no listener')
    expect(running(listener)).toBe(3)
    people[0]?.client.socket.close()
    await expect.poll(() => running(listener)).toBe(3)
  })
})

describe('one screen at a time (#29)', () => {
  async function sender(client: Client) {
    const transport = await client.ok<Transport>({ method: 'createTransport', direction: 'send' })
    await client.ok({ method: 'connectTransport', transportId: transport.id, dtlsParameters: DTLS })
    return (encodings = VP8_SCREEN) =>
      client.request({
        method: 'produce',
        transportId: transport.id,
        kind: 'video',
        rtpParameters: encodings,
      })
  }

  it('refuses a second screen, relays «Показать свой» and frees the screen when it stops', async () => {
    const { port } = await startRoom()
    const alice = await connect(port, 'Алиса')
    const { peerId: aliceId } = await alice.next('welcome')
    const bob = await connect(port, 'Боб')
    const { peerId: bobId, sharerId } = await bob.next('welcome')
    expect(sharerId).toBeNull()
    const aliceShares = await sender(alice)
    const bobShares = await sender(bob)

    const screen = await aliceShares()
    const screenId = (screen.data as { id: string }).id
    expect(await bob.next('screen-share-started')).toMatchObject({ peerId: aliceId })
    expect((await bobShares()).error).toBe('SCREEN_BUSY')
    expect(
      (await bob.request({ method: 'answerScreenRequest', fromPeerId: aliceId, accept: true }))
        .error,
    ).toBe('you are not sharing')

    // Bob asks; Alice says no, then yes.
    expect((await bob.request({ method: 'requestScreen' })).error).toBeUndefined()
    expect(await alice.next('screen-request')).toMatchObject({ fromPeerId: bobId })
    expect((await bob.request({ method: 'requestScreen' })).error).toBe('already asked')
    await alice.ok({ method: 'answerScreenRequest', fromPeerId: bobId, accept: false })
    expect(await bob.next('screen-request-answer')).toMatchObject({ accepted: false })
    await bob.ok({ method: 'requestScreen' })
    await alice.next('screen-request')
    await alice.ok({ method: 'answerScreenRequest', fromPeerId: bobId, accept: true })
    expect(await bob.next('screen-request-answer')).toMatchObject({ accepted: true })

    // Alice stops: the screen is free, Bob shows his, a newcomer learns who shares.
    await alice.ok({ method: 'closeProducer', producerId: screenId })
    expect(await bob.next('screen-share-stopped')).toMatchObject({ peerId: aliceId })
    expect((await bobShares()).error).toBeUndefined()
    const vera = await connect(port, 'Вера')
    expect((await vera.next('welcome')).sharerId).toBe(bobId)
    expect((await vera.request({ method: 'requestScreen' })).error).toBeUndefined()
    expect((await alice.request({ method: 'requestScreen' })).error).toBeUndefined()
  })

  it('frees the screen when the sharer leaves', async () => {
    const { port } = await startRoom()
    const alice = await connect(port, 'Алиса')
    const { peerId: aliceId } = await alice.next('welcome')
    const bob = await connect(port, 'Боб')
    await bob.next('welcome')
    await (
      await sender(alice)
    )()
    await bob.next('screen-share-started')

    alice.socket.close()

    expect(await bob.next('screen-share-stopped')).toMatchObject({ peerId: aliceId })
    expect((await bob.request({ method: 'requestScreen' })).error).toBe('nobody is sharing')
  })
})

describe('room size', () => {
  it('admits 15 people and answers the 16th with ROOM_FULL', async () => {
    const { port, room } = await startRoom({ media: false })
    for (let i = 0; i < 15; i++) {
      const client = await connect(port, `Гость ${i}`)
      await client.next('welcome')
    }
    expect(room.peers).toHaveLength(15)

    const late = await connect(port, 'Опоздавший')
    expect(await late.next('error')).toEqual({ type: 'error', code: 'ROOM_FULL' })
  })
})
