import type { Peer, RoomInfo, SignalingErrorCode } from './signaling'

export type JoinError =
  | SignalingErrorCode
  /** The room has a password and none was given; no attempt was spent. */
  | 'password-required'
  /** The host's certificate is not the one in the invite (PLAN #14). */
  | 'certificate-mismatch'
  | 'unreachable'
  | 'timeout'
  | 'protocol'

export type JoinResult =
  | { ok: true; peerId: string; peers: Peer[]; room: RoomInfo }
  | { ok: false; error: JoinError; room?: RoomInfo }

/** What a light check (hello → challenge, no authentication) learns about a room. */
export type RoomPreview =
  | { status: 'live'; room: RoomInfo }
  | { status: 'offline' }
  /** The host answered with a different certificate than the one in the link. */
  | { status: 'certificate-changed' }

/** Why a joined room ended without the user leaving it. */
export type RoomClosedReason =
  /** The host closed the room on purpose. */
  | 'host-closed'
  /** The connection dropped (network, host computer went to sleep…). */
  | 'connection-lost'

export interface RoomClosedEvent {
  reason: RoomClosedReason
  roomName: string
}
