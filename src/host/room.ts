import { randomUUID, timingSafeEqual } from 'node:crypto'
import type { RawData, WebSocket } from 'ws'
import { newNonce, verifyAuthHmac } from '@shared/auth'
import type { types } from 'mediasoup'
import type { ScreenMode } from '@shared/screen'
import {
  estimateCapacity,
  MAX_PARTICIPANTS,
  screenBudget,
  type ScreenBudget,
} from '@shared/upload-capacity'
import {
  clientMessageSchema,
  parseMessage,
  PROTOCOL_VERSION,
  type HostMessage,
  type MediaRequest,
  type Peer,
  type SignalingErrorCode,
} from '@shared/signaling'
import { peerAlias } from '@shared/log-alias'
import { AttemptLimiter } from './attempt-limiter'
import type { MediaServer, MediaTransport } from './media-server'
import { isScreenAudio, MediaRequestError, PeerMedia, screenLayerOf } from './peer-media'
import { SpeakerSelector } from './speakers'

export interface RoomConfig {
  name: string
  /** Empty string: anyone with the link may enter. */
  password: string
  /** Our certificate's fingerprint, bound into the password HMAC. */
  fingerprint: string
  /** How screens are shared here (PLAN #27); auto when absent. */
  screenMode?: ScreenMode
  /** Entry waits for the organizer's «Впустить» (#42); can change during the call. */
  approval?: boolean
  /** The organizer's app proves itself with it (#42); empty or absent: nobody is organizer. */
  organizerKey?: string
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

/** Requests a participant may have in flight; more is a bug or abuse. */
const MAX_PENDING_REQUESTS = 16

interface Member {
  peer: Peer
  media: PeerMedia | null
  pending: number
  /** Their microphone is off (the audio producer is paused). */
  muted: boolean
  /** The organizer's own connection (#42): may remove people and let them in. */
  organizer: boolean
  /** Brings them back after a dropped link without waiting again; single use. */
  rejoinToken: string
  /** The organizer removed them: no coming back by the token. */
  removed: boolean
  /** When their last chat messages went out (#45), for the rate limit. */
  chatTimes: number[]
}

/** How long after a dropped link the rejoin token still lets someone straight back in (#42). */
export const REJOIN_TOKEN_MS = 60_000

/** The chat (#45): at most this many messages per participant in the window below. */
export const CHAT_BURST = 5
export const CHAT_WINDOW_MS = 3_000

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
  /** Who shares a screen, and its streams (≈1080p and ≈360p, #34); the room allows one (#29). */
  #sharer: { peerId: string; producerIds: Set<string> } | null = null
  /** The host's upload (#86): measured before the call, and seen in the call's statistics. */
  #upload: { measured: number | null; live: number | null } = { measured: null, live: null }
  /** The ceiling the sharer was told last, so it is sent only when it changes. */
  #sentBudget: { peerId: string; budget: ScreenBudget } | null = null
  /** The organizer's upload as everyone was told last (#87); null until it is known. */
  #hostStats: Extract<HostMessage, { type: 'host-stats' }> | null = null
  /** Participants waiting for the sharer's answer to «Показать свой». */
  readonly #screenRequests = new Set<string>()
  /** Entry waits for the organizer (#42). */
  #approval: boolean
  /** Waiting for the organizer's «Впустить», by request id. */
  readonly #waiting = new Map<string, { socket: WebSocket; name: string }>()
  /** Tokens of those whose link dropped, until when they let them back in. */
  readonly #rejoin = new Map<string, number>()

  constructor(
    private readonly config: RoomConfig,
    options: RoomOptions = {},
  ) {
    this.#limiter = options.limiter ?? new AttemptLimiter()
    this.#handshakeTimeoutMs = options.handshakeTimeoutMs ?? 10_000
    this.#media = options.media
    this.#maxPeers = options.maxPeers ?? MAX_PARTICIPANTS
    this.#approval = config.approval ?? false
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
    for (const { socket } of this.#waiting.values()) {
      const message: HostMessage = { type: 'room-closed' }
      socket.send(JSON.stringify(message))
      socket.close(1001, 'Room closed by the host')
    }
    this.#waiting.clear()
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
            approval: this.#approval,
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
            const organizer = this.#isOrganizerKey(message.organizerKey)
            const returning = this.#takeRejoinToken(message.rejoinToken)
            if (this.#approval && !organizer && !returning) this.#wait(socket, message.name)
            else this.#admit(socket, message.name, organizer)
          } else {
            // stdout goes to host.log in main, which masks the address (#106).
            console.log(`join refused: ${ok} (from ${address})`)
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
      console.log(`${peerAlias(member.peer.id)} left, ${this.#peers.size} in the room`)
      // A dropped link may come back without waiting again; a removal may not.
      if (!member.removed) this.#rejoin.set(member.rejoinToken, Date.now() + REJOIN_TOKEN_MS)
      member.media?.close()
      this.#broadcast({ type: 'peer-left', peerId: member.peer.id })
      this.#updateBudget()
    })
  }

  #admit(socket: WebSocket, name: string, organizer = false): void {
    const send = (message: HostMessage): void => {
      socket.send(JSON.stringify(message))
    }
    const peer: Peer = { id: randomUUID(), name, ...(organizer ? { organizer: true } : {}) }
    const media = this.#media
      ? new PeerMedia(this.#media, {
          beforeProduce: (kind, screenAudio) => {
            if (kind === 'video' && this.#sharer && this.#sharer.peerId !== peer.id) {
              throw new MediaRequestError('SCREEN_BUSY')
            }
            // The computer's sound only goes along with one's own screen (#41).
            if (screenAudio && this.#sharer?.peerId !== peer.id) {
              throw new MediaRequestError('not sharing a screen')
            }
          },
          onProducer: (producer) => {
            console.log(
              `${peerAlias(peer.id)} sends ${isScreenAudio(producer) ? 'the screen’s sound' : producer.kind}` +
                (producer.kind === 'video'
                  ? ` (${screenLayerOf(producer) === 1 ? '≈1080p' : '≈360p'})`
                  : ''),
            )
            if (isScreenAudio(producer)) {
              // Part of the screen: neither a voice nor a new share.
            } else if (producer.kind === 'audio') this.#addVoice(producer, peer.id)
            else this.#startSharing(producer, peer.id)
            this.#broadcast(newProducer(peer.id, producer), socket)
          },
          findProducer: (id) => this.#findProducer(id),
          onConsumerClosed: (consumerId) => {
            send({ type: 'consumer-closed', consumerId })
          },
          isForwarded: (producerId) => this.#speakers.forwarded.has(producerId),
          onScreenLayer: (layer) => {
            console.log(`${peerAlias(peer.id)} gets the ${layer === 1 ? '≈1080p' : '≈360p'} screen`)
            send({ type: 'screen-layer', layer })
          },
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
    console.log(`${peerAlias(peer.id)} joined, ${this.#peers.size + 1} in the room`)
    const rejoinToken = randomUUID()
    this.#peers.set(socket, {
      peer,
      media,
      muted: false,
      pending: 0,
      organizer,
      rejoinToken,
      removed: false,
      chatTimes: [],
    })
    send({
      type: 'welcome',
      peerId: peer.id,
      peers: others.map((member) => member.peer),
      routerRtpCapabilities: { ...this.#media?.rtpCapabilities },
      mutedPeers: others.filter((member) => member.muted).map((member) => member.peer.id),
      screenMode: this.config.screenMode ?? 'auto',
      sharerId: this.#sharer?.peerId ?? null,
      organizer,
      approval: this.#approval,
      rejoinToken,
    })
    // The organizer (back after a dropped link, too) learns who is waiting.
    if (organizer) {
      for (const [requestId, waiting] of this.#waiting) {
        send({ type: 'join-request', requestId, name: waiting.name })
      }
    }
    // Whoever is already talking can be consumed right away.
    for (const member of others) {
      for (const producer of member.media?.producers ?? []) {
        send(newProducer(member.peer.id, producer))
      }
    }
    if (this.#hostStats) send(this.#hostStats)
    this.#updateBudget()
  }

  async #serve(member: Member, id: number, request: MediaRequest): Promise<HostMessage> {
    if (
      request.method === 'removePeer' ||
      request.method === 'answerJoin' ||
      request.method === 'setApproval'
    ) {
      const error = this.#organizerRequest(member, request)
      return error === null ? { type: 'response', id, data: {} } : { type: 'response', id, error }
    }
    if (request.method === 'sendChat') {
      const error = this.#chat(member, request.text)
      return error === null ? { type: 'response', id, data: {} } : { type: 'response', id, error }
    }
    if (request.method === 'requestScreen' || request.method === 'answerScreenRequest') {
      const error = this.#screenRequest(member, request)
      return error === null ? { type: 'response', id, data: {} } : { type: 'response', id, error }
    }
    if (!member.media) return { type: 'response', id, error: 'media is not available' }
    if (member.pending >= MAX_PENDING_REQUESTS) {
      return { type: 'response', id, error: 'too many requests' }
    }
    member.pending++
    try {
      const data = await member.media.handle(request)
      return { type: 'response', id, data }
    } catch (error) {
      // mediasoup's own messages (bad parameters) are fine to pass on; nothing secret in them.
      return { type: 'response', id, error: error instanceof Error ? error.message : 'failed' }
    } finally {
      member.pending--
    }
  }

  /** A stream of the screen: the first one starts the share, the last one to close ends it. */
  #startSharing(producer: types.Producer, peerId: string): void {
    if (this.#sharer?.peerId === peerId) {
      this.#sharer.producerIds.add(producer.id)
    } else {
      this.#sharer = { peerId, producerIds: new Set([producer.id]) }
      this.#broadcast({ type: 'screen-share-started', peerId })
      this.#updateBudget()
    }
    producer.observer.on('close', () => {
      const sharer = this.#sharer
      if (!sharer?.producerIds.delete(producer.id) || sharer.producerIds.size > 0) return
      this.#sharer = null
      this.#sentBudget = null
      // Whoever was waiting can show theirs now.
      this.#screenRequests.clear()
      console.log(`${peerAlias(peerId)} stopped sharing`)
      this.#broadcast({ type: 'screen-share-stopped', peerId })
    })
  }

  /** «Показать свой» and the sharer's answer; returns an error or null. */
  #screenRequest(
    member: Member,
    request: Extract<MediaRequest, { method: 'requestScreen' | 'answerScreenRequest' }>,
  ): string | null {
    const sharer = this.#sharer
    if (!sharer) return 'nobody is sharing'
    if (request.method === 'requestScreen') {
      if (sharer.peerId === member.peer.id) return 'you are sharing'
      if (this.#screenRequests.has(member.peer.id)) return 'already asked'
      this.#screenRequests.add(member.peer.id)
      this.#sendTo(sharer.peerId, { type: 'screen-request', fromPeerId: member.peer.id })
      return null
    }
    if (sharer.peerId !== member.peer.id) return 'you are not sharing'
    if (!this.#screenRequests.delete(request.fromPeerId)) return 'no such request'
    this.#sendTo(request.fromPeerId, { type: 'screen-request-answer', accepted: request.accept })
    return null
  }

  /**
   * The chat (#45): passed on to everyone, the sender too, so all see the same order. Nothing
   * is kept and nothing goes to the logs, the text least of all.
   */
  #chat(member: Member, text: string): string | null {
    const now = Date.now()
    member.chatTimes = member.chatTimes.filter((t) => now - t < CHAT_WINDOW_MS)
    if (member.chatTimes.length >= CHAT_BURST) return 'too many messages'
    member.chatTimes.push(now)
    this.#broadcast({ type: 'chat', peerId: member.peer.id, text })
    return null
  }

  /** Constant time, so the key cannot be guessed a character at a time. */
  #isOrganizerKey(key: string | undefined): boolean {
    const expected = this.config.organizerKey
    if (!expected || !key || key.length !== expected.length) return false
    return timingSafeEqual(Buffer.from(key), Buffer.from(expected))
  }

  #takeRejoinToken(token: string | undefined): boolean {
    if (!token) return false
    const until = this.#rejoin.get(token)
    this.#rejoin.delete(token)
    for (const [stale, expiry] of this.#rejoin) if (expiry < Date.now()) this.#rejoin.delete(stale)
    return until !== undefined && until >= Date.now()
  }

  /** Entry waits for the organizer (#42): they get the name, the one waiting gets «waiting». */
  #wait(socket: WebSocket, name: string): void {
    const requestId = randomUUID()
    this.#waiting.set(requestId, { socket, name })
    const waiting: HostMessage = { type: 'waiting' }
    socket.send(JSON.stringify(waiting))
    this.#toOrganizers({ type: 'join-request', requestId, name })
    console.log(`someone is waiting to be let in, ${this.#waiting.size} waiting`)
    socket.once('close', () => {
      if (this.#waiting.delete(requestId))
        this.#toOrganizers({ type: 'join-request-gone', requestId })
    })
  }

  /** The organizer's rights (#42): remove someone, let someone in, entry by approval. */
  #organizerRequest(
    member: Member,
    request: Extract<MediaRequest, { method: 'removePeer' | 'answerJoin' | 'setApproval' }>,
  ): string | null {
    if (!member.organizer) return 'not the organizer'
    switch (request.method) {
      case 'removePeer': {
        if (request.peerId === member.peer.id) return 'cannot remove yourself'
        const target = [...this.#peers].find(([, m]) => m.peer.id === request.peerId)
        if (!target) return 'no such participant'
        const [socket, removed] = target
        removed.removed = true
        console.log(`${peerAlias(removed.peer.id)} removed by the organizer`)
        const message: HostMessage = { type: 'removed' }
        socket.send(JSON.stringify(message))
        socket.close(1000, 'Removed by the organizer')
        return null
      }
      case 'answerJoin': {
        const waiting = this.#waiting.get(request.requestId)
        if (!waiting) return 'no such request'
        this.#waiting.delete(request.requestId)
        this.#toOrganizers({ type: 'join-request-gone', requestId: request.requestId })
        this.#letIn(waiting, request.admit)
        return null
      }
      case 'setApproval': {
        this.#approval = request.enabled
        console.log(`entry by approval: ${request.enabled ? 'on' : 'off'}`)
        this.#toOrganizers({ type: 'approval-changed', enabled: request.enabled })
        // Nobody to approve any more: everyone waiting comes in.
        if (!request.enabled) {
          for (const [requestId, waiting] of [...this.#waiting]) {
            this.#waiting.delete(requestId)
            this.#toOrganizers({ type: 'join-request-gone', requestId })
            this.#letIn(waiting, true)
          }
        }
        return null
      }
    }
  }

  /** In (if there is room) or out, for someone who waited. */
  #letIn(waiting: { socket: WebSocket; name: string }, admit: boolean): void {
    const code = !admit ? 'JOIN_REFUSED' : this.#peers.size >= this.#maxPeers ? 'ROOM_FULL' : null
    console.log(`a waiting participant: ${code ?? 'let in'}`)
    if (code === null) {
      this.#admit(waiting.socket, waiting.name, false)
      return
    }
    const message: HostMessage = { type: 'error', code }
    waiting.socket.send(JSON.stringify(message))
    waiting.socket.close(1000, code)
  }

  /**
   * The host's upload (#86). The measured one is the base: the statistics only show what is sent
   * now, and a ceiling taken from them would push itself down. They may raise it, never lower.
   */
  setUpload(source: 'measured' | 'live', mbps: number): void {
    this.#upload = { ...this.#upload, [source]: mbps }
    this.#updateBudget()
    this.#updateHostStats()
  }

  /** Everyone sees the organizer's upload (#87); sent when it changes by a whole Mbit/s. */
  #updateHostStats(): void {
    const { measured, live } = this.#upload
    const mbps = Math.max(measured ?? 0, live ?? 0)
    if (mbps <= 0) return
    const { participants, screen } = estimateCapacity(mbps)
    const stats: Extract<HostMessage, { type: 'host-stats' }> = {
      type: 'host-stats',
      uploadMbps: Math.round(mbps * 10) / 10,
      participants,
      screen,
      measured: measured !== null,
    }
    const before = this.#hostStats
    if (
      before &&
      Math.round(before.uploadMbps) === Math.round(stats.uploadMbps) &&
      before.participants === stats.participants &&
      before.screen === stats.screen &&
      before.measured === stats.measured
    ) {
      return
    }
    this.#hostStats = stats
    this.#broadcast(stats)
  }

  /** Tells the sharer how much of the big screen stream the upload carries to everyone. */
  #updateBudget(): void {
    const sharer = this.#sharer
    const { measured, live } = this.#upload
    if (!sharer || measured === null) return
    // The organizer watches on this very computer: their copy does not use the upload.
    const viewers = [...this.#peers.values()].filter(
      (member) => member.peer.id !== sharer.peerId && !member.organizer,
    ).length
    const budget = screenBudget(Math.max(measured, live ?? 0), viewers)
    const sent = this.#sentBudget
    if (
      !budget ||
      (sent?.peerId === sharer.peerId &&
        sent.budget.height === budget.height &&
        sent.budget.maxBitrate === budget.maxBitrate)
    ) {
      return
    }
    this.#sentBudget = { peerId: sharer.peerId, budget }
    console.log(`screen ceiling for ${viewers} viewers: ${budget.height}p`)
    this.#sendTo(sharer.peerId, { type: 'screen-budget', ...budget })
  }

  #toOrganizers(message: HostMessage): void {
    const text = JSON.stringify(message)
    for (const [socket, member] of this.#peers) if (member.organizer) socket.send(text)
  }

  #sendTo(peerId: string, message: HostMessage): void {
    for (const [socket, member] of this.#peers) {
      if (member.peer.id === peerId) socket.send(JSON.stringify(message))
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

function newProducer(peerId: string, producer: types.Producer): HostMessage {
  return {
    type: 'new-producer',
    peerId,
    producerId: producer.id,
    kind: producer.kind,
    ...(producer.kind === 'video' ? { screenLayer: screenLayerOf(producer) } : {}),
    ...(isScreenAudio(producer) ? { screenAudio: true } : {}),
  }
}

/** Text of a ws frame (ws hands out Buffer, ArrayBuffer or fragments). */
function frameText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return data.toString('utf8')
}
