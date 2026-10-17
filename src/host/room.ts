import { randomUUID } from 'node:crypto'
import type { RawData, WebSocket } from 'ws'
import { newNonce, verifyAuthHmac } from '@shared/auth'
import {
  clientMessageSchema,
  parseMessage,
  PROTOCOL_VERSION,
  type HostMessage,
  type Peer,
  type SignalingErrorCode,
} from '@shared/signaling'
import { AttemptLimiter } from './attempt-limiter'

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
}

/**
 * The room on the host: admits connections through the hello → challenge → auth handshake and
 * keeps the list of authenticated peers. Media and room events join later (#19 onwards).
 */
export class Room {
  readonly #peers = new Map<WebSocket, Peer>()
  readonly #limiter: AttemptLimiter
  readonly #handshakeTimeoutMs: number

  constructor(
    private readonly config: RoomConfig,
    options: RoomOptions = {},
  ) {
    this.#limiter = options.limiter ?? new AttemptLimiter()
    this.#handshakeTimeoutMs = options.handshakeTimeoutMs ?? 10_000
  }

  get peers(): Peer[] {
    return [...this.#peers.values()]
  }

  /** Tells every participant the host closed the room, then disconnects them. */
  close(): void {
    for (const socket of this.#peers.keys()) {
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
      if (stage === 'joined') return // room events arrive with later issues
      const message = isBinary ? null : parseMessage(clientMessageSchema, frameText(data))
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
          if (ok === true) {
            clearTimeout(timer)
            const peer: Peer = { id: randomUUID(), name: message.name }
            const others = this.peers
            this.#peers.set(socket, peer)
            send({ type: 'welcome', peerId: peer.id, peers: others })
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
      this.#peers.delete(socket)
    })
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
