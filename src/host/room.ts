import { randomUUID } from 'node:crypto'
import type { RawData, WebSocket } from 'ws'
import { newNonce, verifyAuthHmac } from '@shared/auth'
import type { types } from 'mediasoup'
import { MAX_PARTICIPANTS } from '@shared/upload-capacity'
import {
  clientMessageSchema,
  parseMessage,
  PROTOCOL_VERSION,
  type HostMessage,
  type MediaRequest,
  type Peer,
  type SignalingErrorCode,
} from '@shared/signaling'
import { AttemptLimiter } from './attempt-limiter'
import type { MediaServer, MediaTransport } from './media-server'
import { PeerMedia } from './peer-media'
import { SpeakerSelector } from './speakers'

export interface RoomConfig {
  name: string
  /** Empty string: anyone with the link may enter. */
  password: string
  /** Our certificate's fingerprint, bound into the password HMAC. */
  fingerprint: string
}

export interface RoomOptions {
  limiter?: AttemptLimiter
  /** A connection that does not finish hello + auth in time is dropped. */
  handshakeTimeoutMs?: number
  /** The SFU; without it (signalling tests) media requests are refused. */
  media?: MediaServer
  /** Everyone counts, the host's own connection too (PLAN: 15, the 16th gets ROOM_FULL). */
  maxPeers?: number
}

interface Member {
  peer: Peer
  media: PeerMedia | null
  /** Their microphone is off (the audio producer is paused). */
  muted: boolean
}

/**
 * The room on the host: admits connections through the hello → challenge → auth handshake,
 * keeps the authenticated peers and serves their media requests on the SFU.
 */
export class Room {
  readonly #peers = new Map<WebSocket, Member>()
  readonly #limiter: AttemptLimiter
  readonly #handshakeTimeoutMs: number
  readonly #media: MediaServer | undefined
  readonly #maxPeers: number
  readonly #speakers = new SpeakerSelector()
  /** Audio producer → the participant whose voice it is. */
  readonly #voiceOwner = new Map<string, string>()
  #speaking: string[] = []

  constructor(
    private readonly config: RoomConfig,
    options: RoomOptions = {},
  ) {
    this.#limiter = options.limiter ?? new AttemptLimiter()
    this.#handshakeTimeoutMs = options.handshakeTimeoutMs ?? 10_000
    this.#media = options.media
    this.#maxPeers = options.maxPeers ?? MAX_PARTICIPANTS
    const levels = this.#media?.audioLevels
    levels?.on('volumes', (volumes) => {
      const loudest = volumes.map((v) => v.producer.id)
      if (this.#speakers.heard(loudest)) this.#refreshForwarding()
      this.#setSpeaking(
        loudest.flatMap((id) => {
          const owner = this.#voiceOwner.get(id)
          return owner === undefined ? [] : [owner]
        }),
      )
    })
    levels?.on('silence', () => {
      this.#setSpeaking([])
    })
  }

  get peers(): Peer[] {
    return [...this.#peers.values()].map((member) => member.peer)
  }

  /** Every participant's transports, for the upload estimate. */
  get transports(): MediaTransport[] {
    return [...this.#peers.values()].flatMap((member) => member.media?.transports ?? [])
  }

  /** Tells every participant the host closed the room, then disconnects them. */
  close(): void {
    for (const [socket, member] of this.#peers) {
      member.media?.close()
      const message: HostMessage = { type: 'room-closed' }
      socket.send(JSON.stringify(message))
      socket.close(1001, 'Room closed by the host')
    }
    this.#peers.clear()
  }

  accept(socket: WebSocket, address: string): void {
    let stage: 'hello' | 'auth' | 'joined' = 'hello'
    let nonce = ''
    const timer = setTimeout(() => {
      socket.close(1008, 'Handshake timeout')
    }, this.#handshakeTimeoutMs)

    const send = (message: HostMessage): void => {
      socket.send(JSON.stringify(message))
    }
    const reject = (code: SignalingErrorCode): void => {
      clearTimeout(timer)
      send({ type: 'error', code })
      socket.close(1000, code)
    }

    socket.on('message', (data, isBinary) => {
      const message = isBinary ? null : parseMessage(clientMessageSchema, frameText(data))
      if (stage === 'joined') {
        const member = this.#peers.get(socket)
        // Requests sent before the auth check finished are not answered.
        if (member && message?.type === 'request') {
          void this.#serve(member, message.id, message.request).then(send)
        } else if (member) {
          socket.close(1008, 'BAD_REQUEST')
        }
        return
      }
      if (message === null) {
        reject('BAD_REQUEST')
        return
      }

      if (stage === 'hello' && message.type === 'hello') {
        if (message.protocolVersion !== PROTOCOL_VERSION) {
          reject('VERSION_MISMATCH')
          return
        }
        stage = 'auth'
        nonce = newNonce()
        send({
          type: 'challenge',
          nonce,
          room: {
            name: this.config.name,
            peerCount: this.#peers.size,
            hasPassword: this.config.password !== '',
          },
        })
        return
      }

      if (stage === 'auth' && message.type === 'auth') {
        stage = 'joined' // ignore anything else until the check finishes
        void this.#authenticate(message.hmac, nonce, address).then((ok) => {
          // Checked after the password: others may have joined while it was being verified.
          if (ok === true && this.#peers.size >= this.#maxPeers) ok = 'ROOM_FULL'
          if (ok === true) {
            clearTimeout(timer)
            this.#admit(socket, message.name)
          } else {
            reject(ok)
          }
        })
        return
      }

      reject('BAD_REQUEST')
    })

    socket.on('close', () => {
      clearTimeout(timer)
      const member = this.#peers.get(socket)
      if (!member) return
      this.#peers.delete(socket)
      member.media?.close()
      this.#broadcast({ type: 'peer-left', peerId: member.peer.id })
    })
  }

  #admit(socket: WebSocket, name: string): void {
    const send = (message: HostMessage): void => {
      socket.send(JSON.stringify(message))
    }
    const peer: Peer = { id: randomUUID(), name }
    const media = this.#media
      ? new PeerMedia(this.#media, {
          onProducer: (producer) => {
            if (producer.kind === 'audio') this.#addVoice(producer, peer.id)
            this.#broadcast(
              {
                type: 'new-producer',
                peerId: peer.id,
                producerId: producer.id,
                kind: producer.kind,
              },
              socket,
            )
          },
          findProducer: (id) => this.#findProducer(id),
          onConsumerClosed: (consumerId) => {
            send({ type: 'consumer-closed', consumerId })
          },
          isForwarded: (producerId) => this.#speakers.forwarded.has(producerId),
          onProducerPaused: (producer, paused) => {
            const member = this.#peers.get(socket)
            if (producer.kind !== 'audio' || !member || member.muted === paused) return
            member.muted = paused
            this.#broadcast({ type: 'peer-muted', peerId: peer.id, muted: paused })
          },
        })
      : null
    const others = [...this.#peers.values()]
    this.#broadcast({ type: 'peer-joined', peer })
    this.#peers.set(socket, { peer, media, muted: false })
    send({
      type: 'welcome',
      peerId: peer.id,
      peers: others.map((member) => member.peer),
      routerRtpCapabilities: { ...this.#media?.rtpCapabilities },
      mutedPeers: others.filter((member) => member.muted).map((member) => member.peer.id),
    })
    // Whoever is already talking can be consumed right away.
    for (const member of others) {
      for (const producer of member.media?.producers ?? []) {
        send({
          type: 'new-producer',
          peerId: member.peer.id,
          producerId: producer.id,
          kind: producer.kind,
        })
      }
    }
  }

  async #serve(member: Member, id: number, request: MediaRequest): Promise<HostMessage> {
    if (!member.media) return { type: 'response', id, error: 'media is not available' }
    try {
      const data = await member.media.handle(request)
      return { type: 'response', id, data }
    } catch (error) {
      // mediasoup's own messages (bad parameters) are fine to pass on; nothing secret in them.
      return { type: 'response', id, error: error instanceof Error ? error.message : 'failed' }
    }
  }

  #addVoice(producer: types.Producer, peerId: string): void {
    this.#voiceOwner.set(producer.id, peerId)
    void this.#media?.audioLevels.addProducer({ producerId: producer.id }).catch(() => undefined)
    if (this.#speakers.add(producer.id)) this.#refreshForwarding()
    producer.observer.on('close', () => {
      this.#voiceOwner.delete(producer.id)
      if (this.#speakers.remove(producer.id)) this.#refreshForwarding()
      this.#setSpeaking(this.#speaking.filter((id) => id !== peerId))
    })
  }

  /** Each participant gets only the forwarded voices (at most three, PLAN §2). */
  #refreshForwarding(): void {
    for (const member of this.#peers.values()) {
      void member.media?.refresh().catch((error: unknown) => {
        console.warn('[host] could not update forwarded voices:', error)
      })
    }
  }

  /** Tells everyone who is speaking, when that changes. */
  #setSpeaking(peerIds: string[]): void {
    const unique = [...new Set(peerIds)]
    const same =
      unique.length === this.#speaking.length && unique.every((id) => this.#speaking.includes(id))
    if (same) return
    this.#speaking = unique
    this.#broadcast({ type: 'active-speakers', peerIds: unique })
  }

  #findProducer(id: string): types.Producer | undefined {
    for (const member of this.#peers.values()) {
      const producer = member.media?.producers.find((p) => p.id === id)
      if (producer) return producer
    }
    return undefined
  }

  /** Sends to every joined participant except `except`. */
  #broadcast(message: HostMessage, except?: WebSocket): void {
    const text = JSON.stringify(message)
    for (const socket of this.#peers.keys()) {
      if (socket !== except) socket.send(text)
    }
  }

  async #authenticate(
    hmac: string | null,
    nonce: string,
    address: string,
  ): Promise<true | SignalingErrorCode> {
    if (this.#limiter.isBlocked(address)) return 'TOO_MANY_ATTEMPTS'
    if (this.config.password === '') return true
    const valid =
      hmac !== null &&
      (await verifyAuthHmac(this.config.password, nonce, this.config.fingerprint, hmac))
    if (valid) return true
    this.#limiter.recordFailure(address)
    return 'WRONG_PASSWORD'
  }
}

/** Text of a ws frame (ws hands out Buffer, ArrayBuffer or fragments). */
function frameText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return data.toString('utf8')
}
