import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { TLSSocket } from 'node:tls'
import { WebSocket, type RawData } from 'ws'
import { computeAuthHmac } from '@shared/auth'
import type { Invite } from '@shared/invite'
import type {
  JoinResult,
  MediaResponse,
  RoomClosedReason,
  RoomEvent,
  RoomPreview,
} from '@shared/room'
import {
  hostMessageSchema,
  parseMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
  type MediaRequest,
  type RoomInfo,
} from '@shared/signaling'

export interface JoinRequest {
  invite: Invite
  name: string
  /** From the link or typed by the user; ignored when the room has no password. */
  password: string | undefined
  timeoutMs?: number
  /** How long the host may take to answer a media request. */
  requestTimeoutMs?: number
}

export interface RoomConnection {
  readonly result: JoinResult
  /** Leaves the room; no onClosed notification follows. */
  close(): void
  /** Called once if the room ends without close(): the host closed it or the link dropped. */
  onClosed(listener: (reason: RoomClosedReason) => void): void
  /** A media request to the host; never throws. */
  request(request: MediaRequest): Promise<MediaResponse>
  /** Room events after joining; those that came before the listener are replayed to it. */
  onEvent(listener: (event: RoomEvent) => void): void
}

/**
 * Connects to a host as a client: WSS, certificate pinned to the invite's fingerprint, then the
 * hello → challenge → auth handshake. Runs in main because only Node can check a self-signed
 * certificate by fingerprint. Never throws: every failure is a JoinResult.
 */
export function joinRoom(request: JoinRequest): Promise<RoomConnection> {
  const { invite } = request
  const socket = openSocket(invite, request.timeoutMs ?? 10_000)

  let leftOnPurpose = false
  let hostClosed = false
  let closedListener: ((reason: RoomClosedReason) => void) | undefined
  let eventListener: ((event: RoomEvent) => void) | undefined
  // Events that arrive with welcome (who is already talking) wait for the listener.
  const earlyEvents: RoomEvent[] = []
  const pending = new Map<number, (response: MediaResponse) => void>()
  let nextId = 0
  socket.on('close', () => {
    for (const answer of pending.values()) answer({ ok: false, error: 'disconnected' })
    pending.clear()
    if (settled && !leftOnPurpose) closedListener?.(hostClosed ? 'host-closed' : 'connection-lost')
  })
  let settled = false

  const sendRequest = (media: MediaRequest): Promise<MediaResponse> => {
    if (socket.readyState !== WebSocket.OPEN) {
      return Promise.resolve({ ok: false, error: 'disconnected' })
    }
    const id = nextId++
    const message: ClientMessage = { type: 'request', id, request: media }
    socket.send(JSON.stringify(message))
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        resolve({ ok: false, error: 'timeout' })
      }, request.requestTimeoutMs ?? 10_000)
      pending.set(id, (response) => {
        clearTimeout(timer)
        resolve(
          response.ok && media.method === 'createTransport'
            ? { ok: true, data: pointCandidatesAt(response.data, invite.host) }
            : response,
        )
      })
    })
  }

  return new Promise((resolve) => {
    let roomInfo: RoomInfo | null = null
    const finish = (result: JoinResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (!result.ok) {
        leftOnPurpose = true
        socket.terminate()
      }
      resolve({
        result,
        close: () => {
          leftOnPurpose = true
          socket.close(1000, 'Left the room')
        },
        onClosed: (listener) => {
          closedListener = listener
        },
        request: sendRequest,
        onEvent: (listener) => {
          eventListener = listener
          for (const event of earlyEvents.splice(0)) listener(event)
        },
      })
    }
    const timer = setTimeout(() => {
      finish({ ok: false, error: 'timeout' })
    }, request.timeoutMs ?? 10_000)
    const send = (message: ClientMessage): void => {
      socket.send(JSON.stringify(message))
    }

    socket.once('upgrade', (response) => {
      if (presentedFingerprint(response) !== invite.fingerprint) {
        finish({ ok: false, error: 'certificate-mismatch' })
      }
    })

    socket.once('open', () => {
      if (!settled) send({ type: 'hello', protocolVersion: PROTOCOL_VERSION })
    })

    socket.on('message', (data, isBinary) => {
      const message = isBinary ? null : parseMessage(hostMessageSchema, frameText(data))
      if (message === null) {
        finish({ ok: false, error: 'protocol' })
        return
      }
      switch (message.type) {
        case 'challenge': {
          const { room } = message
          if (room.hasPassword && !request.password) {
            // Do not spend one of the limited attempts on an empty password.
            finish({ ok: false, error: 'password-required', room })
            return
          }
          const hmac = room.hasPassword
            ? computeAuthHmac(request.password ?? '', message.nonce, invite.fingerprint)
            : Promise.resolve(null)
          roomInfo = room
          void hmac.then((value) => {
            if (!settled) send({ type: 'auth', name: request.name, hmac: value })
          })
          return
        }
        case 'welcome':
          finish(
            roomInfo === null
              ? { ok: false, error: 'protocol' }
              : {
                  ok: true,
                  peerId: message.peerId,
                  peers: message.peers,
                  room: roomInfo,
                  routerRtpCapabilities: message.routerRtpCapabilities,
                },
          )
          return
        case 'response': {
          const answer = pending.get(message.id)
          pending.delete(message.id)
          answer?.(
            message.error === undefined
              ? { ok: true, data: message.data }
              : { ok: false, error: message.error },
          )
          return
        }
        case 'peer-joined':
        case 'peer-left':
        case 'new-producer':
        case 'consumer-closed':
          if (eventListener) eventListener(message)
          else earlyEvents.push(message)
          return
        case 'error':
          finish({ ok: false, error: message.code })
          return
        case 'room-closed':
          hostClosed = true
          return
      }
    })

    socket.once('error', () => {
      finish({ ok: false, error: 'unreachable' })
    })
    socket.once('close', () => {
      finish({ ok: false, error: 'unreachable' })
    })
  })
}

/**
 * Light check (PLAN #15, #17): hello → challenge, then disconnect without authenticating.
 * The challenge carries the room name, the number of people inside and whether a password is
 * needed — never names. Never throws.
 */
export function probeRoom(
  invite: Omit<Invite, 'password'>,
  timeoutMs = 4000,
): Promise<RoomPreview> {
  const socket = openSocket(invite, timeoutMs)
  return new Promise((resolve) => {
    let settled = false
    const finish = (status: RoomPreview): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.terminate()
      resolve(status)
    }
    const timer = setTimeout(() => {
      finish({ status: 'offline' })
    }, timeoutMs)

    socket.once('upgrade', (response) => {
      if (presentedFingerprint(response) !== invite.fingerprint) {
        finish({ status: 'certificate-changed' })
      }
    })
    socket.once('open', () => {
      if (!settled) {
        const hello: ClientMessage = { type: 'hello', protocolVersion: PROTOCOL_VERSION }
        socket.send(JSON.stringify(hello))
      }
    })
    socket.on('message', (data, isBinary) => {
      const message = isBinary ? null : parseMessage(hostMessageSchema, frameText(data))
      finish(
        message?.type === 'challenge'
          ? { status: 'live', room: message.room }
          : { status: 'offline' },
      )
    })
    socket.once('error', () => {
      finish({ status: 'offline' })
    })
    socket.once('close', () => {
      finish({ status: 'offline' })
    })
  })
}

/**
 * The host only knows its own local address; media must go where signalling went — the host
 * from the invite (the router forwards the same port for UDP).
 */
export function pointCandidatesAt(data: unknown, host: string): unknown {
  if (typeof data !== 'object' || data === null || !('iceCandidates' in data)) return data
  const { iceCandidates } = data
  if (!Array.isArray(iceCandidates)) return data
  return {
    ...data,
    iceCandidates: iceCandidates.map((candidate: unknown) =>
      typeof candidate === 'object' && candidate !== null
        ? { ...candidate, ip: host, address: host }
        : candidate,
    ),
  }
}

/** WSS to the host. The CA check is replaced by comparing fingerprints before sending anything. */
function openSocket(invite: Omit<Invite, 'password'>, timeoutMs: number): WebSocket {
  const host = invite.hostKind === 'ipv6' ? `[${invite.host}]` : invite.host
  return new WebSocket(`wss://${host}:${invite.port}/`, {
    rejectUnauthorized: false,
    handshakeTimeout: timeoutMs,
    perMessageDeflate: false,
  })
}

function presentedFingerprint(response: IncomingMessage): string | undefined {
  const peer = (response.socket as TLSSocket).getPeerX509Certificate()
  return peer ? createHash('sha256').update(peer.raw).digest('base64url') : undefined
}

/** Text of a ws frame (ws hands out Buffer, ArrayBuffer or fragments). */
function frameText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return data.toString('utf8')
}
