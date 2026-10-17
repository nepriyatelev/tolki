import { createHash } from 'node:crypto'
import type { TLSSocket } from 'node:tls'
import { WebSocket, type RawData } from 'ws'
import { computeAuthHmac } from '@shared/auth'
import type { Invite } from '@shared/invite'
import type { JoinResult } from '@shared/room'
import {
  hostMessageSchema,
  parseMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
  type RoomInfo,
} from '@shared/signaling'

export interface JoinRequest {
  invite: Invite
  name: string
  /** From the link or typed by the user; ignored when the room has no password. */
  password: string | undefined
  timeoutMs?: number
}

export interface RoomConnection {
  readonly result: JoinResult
  close(): void
}

/**
 * Connects to a host as a client: WSS, certificate pinned to the invite's fingerprint, then the
 * hello → challenge → auth handshake. Runs in main because only Node can check a self-signed
 * certificate by fingerprint. Never throws: every failure is a JoinResult.
 */
export function joinRoom(request: JoinRequest): Promise<RoomConnection> {
  const { invite } = request
  const host = invite.hostKind === 'ipv6' ? `[${invite.host}]` : invite.host
  // The CA check is replaced by the fingerprint comparison below, before anything is sent.
  const socket = new WebSocket(`wss://${host}:${invite.port}/`, {
    rejectUnauthorized: false,
    handshakeTimeout: request.timeoutMs ?? 10_000,
    perMessageDeflate: false,
  })

  return new Promise((resolve) => {
    let settled = false
    let roomInfo: RoomInfo | null = null
    const finish = (result: JoinResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (!result.ok) socket.terminate()
      resolve({
        result,
        close: () => {
          socket.close(1000, 'Left the room')
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
      const peer = (response.socket as TLSSocket).getPeerX509Certificate()
      const fingerprint = peer
        ? createHash('sha256').update(peer.raw).digest('base64url')
        : undefined
      if (fingerprint !== invite.fingerprint) finish({ ok: false, error: 'certificate-mismatch' })
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
              : { ok: true, peerId: message.peerId, peers: message.peers, room: roomInfo },
          )
          return
        case 'error':
          finish({ ok: false, error: message.code })
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

/** Text of a ws frame (ws hands out Buffer, ArrayBuffer or fragments). */
function frameText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return data.toString('utf8')
}
