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
