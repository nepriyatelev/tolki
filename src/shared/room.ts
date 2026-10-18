import type { ScreenMode } from './screen'
import type { HostMessage, Peer, RoomInfo, SignalingErrorCode } from './signaling'

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
  | {
      ok: true
      peerId: string
      peers: Peer[]
      room: RoomInfo
      /** For the renderer's mediasoup Device. */
      routerRtpCapabilities: Record<string, unknown>
      /** Participants whose microphone is off. */
      mutedPeers: string[]
      /** How screens are shared in this room. */
      screenMode: ScreenMode
      /** Who shares a screen right now, if anyone. */
      sharerId: string | null
    }
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

/** What happens in a joined room: people come and go, voices start and stop. */
export type RoomEvent = Extract<
  HostMessage,
  {
    type:
      | 'peer-joined'
      | 'peer-left'
      | 'new-producer'
      | 'consumer-closed'
      | 'active-speakers'
      | 'peer-muted'
      | 'screen-share-started'
      | 'screen-share-stopped'
      | 'screen-request'
      | 'screen-request-answer'
      | 'screen-layer'
  }
>

/** The host's answer to a media request. */
export type MediaResponse = { ok: true; data: unknown } | { ok: false; error: string }
