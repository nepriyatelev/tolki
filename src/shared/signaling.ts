import { z } from 'zod'
import { CHAT_MAX_LENGTH, chatTextSchema } from './chat'
import { SCREEN_MODES } from './screen'

/**
 * Signalling protocol over WSS between a client and the host (PLAN §5):
 *   hello → challenge {nonce, room} → auth {name, hmac} → welcome | error
 * After `welcome` the client sends numbered media requests and the host answers each one with a
 * `response` of the same id; room events arrive as notifications.
 * Every message is JSON validated with these schemas on both ends.
 */

export const PROTOCOL_VERSION = 1

export const errorCodeSchema = z.enum([
  'WRONG_PASSWORD',
  'ROOM_FULL',
  'TOO_MANY_ATTEMPTS',
  'VERSION_MISMATCH',
  'SCREEN_BUSY',
  /** The organizer did not let this one in (#42). */
  'JOIN_REFUSED',
  /** Malformed or out-of-order message. */
  'BAD_REQUEST',
])
export type SignalingErrorCode = z.infer<typeof errorCodeSchema>

// eslint-disable-next-line no-control-regex -- control characters are exactly what we reject
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

export const peerNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .refine((name) => !CONTROL_CHARS.test(name), 'control characters')

export const peerSchema = z.object({ id: z.string(), name: z.string() })
export type Peer = z.infer<typeof peerSchema>

/** What the host tells anyone who connects, before authentication: no participant names. */
export const roomInfoSchema = z.object({
  name: z.string(),
  peerCount: z.number().int().min(0),
  hasPassword: z.boolean(),
  /** Entry waits for the organizer's «Впустить» (#42); absent: no. */
  approval: z.boolean().optional().catch(undefined),
})
export type RoomInfo = z.infer<typeof roomInfoSchema>

/**
 * mediasoup structures (RTP capabilities and parameters, DTLS parameters) travel as plain JSON
 * objects; mediasoup validates them in depth on the host.
 */
const mediaObjectSchema = z.record(z.string(), z.unknown())
const mediaIdSchema = z.string().min(1).max(64)

/**
 * A shared screen goes out as two streams (#34): 1 is ≈1080p (H.264, in hardware where the
 * computer can), 0 is ≈360p (cheap VP8). Each viewer gets one of them.
 */
export const screenLayerSchema = z.union([z.literal(0), z.literal(1)])
export type ScreenLayer = z.infer<typeof screenLayerSchema>

export const mediaRequestSchema = z.discriminatedUnion('method', [
  /** `send` carries the microphone (later the screen), `recv` everything from others. */
  z.object({ method: z.literal('createTransport'), direction: z.enum(['send', 'recv']) }),
  z.object({
    method: z.literal('connectTransport'),
    transportId: mediaIdSchema,
    dtlsParameters: mediaObjectSchema,
  }),
  z.object({
    method: z.literal('produce'),
    transportId: mediaIdSchema,
    kind: z.enum(['audio', 'video']),
    rtpParameters: mediaObjectSchema,
    /** Video only: which of the screen's streams this is; without it, the ≈1080p one. */
    screenLayer: screenLayerSchema.optional(),
    /** Audio only: the computer's sound shared with the screen (#41), not a voice. */
    screenAudio: z.literal(true).optional(),
  }),
  /** Consumers start paused; the client resumes them once its side is ready. */
  z.object({
    method: z.literal('consume'),
    transportId: mediaIdSchema,
    producerId: mediaIdSchema,
    rtpCapabilities: mediaObjectSchema,
  }),
  z.object({ method: z.literal('resumeConsumer'), consumerId: mediaIdSchema }),
  /** The viewer hid it (window minimized, screen scrolled away): stop sending it to them. */
  z.object({ method: z.literal('pauseConsumer'), consumerId: mediaIdSchema }),
  /**
   * Which of the screen's streams the viewer wants by the size it is shown at. The host still
   * sends ≈360p when the viewer's network cannot carry ≈1080p, and says which with
   * `screen-layer`.
   */
  z.object({ method: z.literal('setScreenLayer'), layer: screenLayerSchema }),
  /** Mute and unmute: the host stops forwarding the producer and tells everyone. */
  z.object({ method: z.literal('pauseProducer'), producerId: mediaIdSchema }),
  z.object({ method: z.literal('resumeProducer'), producerId: mediaIdSchema }),
  /** The participant stopped sending it (e.g. ended screen sharing). */
  z.object({ method: z.literal('closeProducer'), producerId: mediaIdSchema }),
  /** Media stalled while signalling is fine: new ICE credentials for the transport (#31). */
  z.object({ method: z.literal('restartIce'), transportId: mediaIdSchema }),
  /** «Показать свой»: ask whoever shares now to give way (PLAN #29). */
  z.object({ method: z.literal('requestScreen') }),
  /** The current sharer's answer to a request. */
  z.object({
    method: z.literal('answerScreenRequest'),
    fromPeerId: z.string().max(64),
    accept: z.boolean(),
  }),
  /** The organizer only (#42): disconnect a participant; they may come back by the link. */
  z.object({ method: z.literal('removePeer'), peerId: z.string().max(64) }),
  /** The organizer only: let someone waiting in, or not. */
  z.object({ method: z.literal('answerJoin'), requestId: z.string().max(64), admit: z.boolean() }),
  /** The organizer only: whether entry waits for them. Turning it off lets everyone waiting in. */
  z.object({ method: z.literal('setApproval'), enabled: z.boolean() }),
  /** A chat message (#45): the host passes it to everyone, the sender too, and keeps nothing. */
  z.object({ method: z.literal('sendChat'), text: chatTextSchema }),
])
export type MediaRequest = z.infer<typeof mediaRequestSchema>
export type MediaMethod = MediaRequest['method']

/** ICE/DTLS data a client needs to set up its side of a transport. */
export interface TransportParameters {
  id: string
  iceParameters: Record<string, unknown>
  /**
   * The host only knows its local address; the client replaces `address` with the host it
   * dialled (the invite's `h`), so media follows the same path as signalling.
   */
  iceCandidates: Record<string, unknown>[]
  dtlsParameters: Record<string, unknown>
}

export interface MediaResults {
  createTransport: TransportParameters
  connectTransport: Record<string, never>
  produce: { id: string }
  consume: {
    id: string
    producerId: string
    kind: 'audio' | 'video'
    rtpParameters: Record<string, unknown>
  }
  resumeConsumer: Record<string, never>
  pauseConsumer: Record<string, never>
  setScreenLayer: Record<string, never>
  pauseProducer: Record<string, never>
  resumeProducer: Record<string, never>
  closeProducer: Record<string, never>
  restartIce: { iceParameters: Record<string, unknown> }
  requestScreen: Record<string, never>
  answerScreenRequest: Record<string, never>
  removePeer: Record<string, never>
  answerJoin: Record<string, never>
  setApproval: Record<string, never>
  sendChat: Record<string, never>
}

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), protocolVersion: z.number().int() }),
  z.object({
    type: z.literal('auth'),
    name: peerNameSchema,
    /** base64url HMAC-SHA256; null when the room has no password. */
    hmac: z.string().max(64).nullable(),
    /** The organizer's own app (#42): proves their rights. */
    organizerKey: z.string().max(64).optional(),
    /** Coming back after a dropped link (#31): no waiting for the organizer again (#42). */
    rejoinToken: z.string().max(64).optional(),
  }),
  z.object({
    type: z.literal('request'),
    id: z.number().int().min(0),
    request: mediaRequestSchema,
  }),
])
export type ClientMessage = z.infer<typeof clientMessageSchema>

export const hostMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('challenge'), nonce: z.string().max(64), room: roomInfoSchema }),
  z.object({
    type: z.literal('welcome'),
    peerId: z.string(),
    peers: z.array(peerSchema),
    routerRtpCapabilities: mediaObjectSchema,
    /** Participants whose microphone is off right now. */
    mutedPeers: z.array(z.string()),
    /** How screens are shared in this room (PLAN #27). */
    screenMode: z.enum(SCREEN_MODES).catch('auto'),
    /** Who shares a screen right now; one at a time (PLAN #29). */
    sharerId: z.string().nullable().catch(null),
    /** This connection is the organizer's (#42): may remove people and let them in. */
    organizer: z.boolean().catch(false).default(false),
    /** Entry waits for the organizer now (#42). */
    approval: z.boolean().catch(false).default(false),
    /** For coming back after a dropped link without waiting again (#42); single use. */
    rejoinToken: z.string().max(64).optional(),
  }),
  /** Entry waits for the organizer's «Впустить» (#42); welcome or JOIN_REFUSED comes later. */
  z.object({ type: z.literal('waiting') }),
  /** The organizer removed this participant (#42); the connection closes next. */
  z.object({ type: z.literal('removed') }),
  /** To the organizer: someone wants in (#42). Only the name they typed, nothing else. */
  z.object({ type: z.literal('join-request'), requestId: z.string(), name: z.string() }),
  /** To the organizer: the request is answered, or the one waiting left. */
  z.object({ type: z.literal('join-request-gone'), requestId: z.string() }),
  /** To the organizer: entry waits for them now, or not. */
  z.object({ type: z.literal('approval-changed'), enabled: z.boolean() }),
  /** A chat message (#45), to everyone in the room at the moment. */
  z.object({ type: z.literal('chat'), peerId: z.string(), text: z.string().max(CHAT_MAX_LENGTH) }),
  z.object({ type: z.literal('error'), code: errorCodeSchema }),
  /** Answer to the client's `request` with the same id: `data` on success, otherwise `error`. */
  z.object({
    type: z.literal('response'),
    id: z.number().int(),
    data: z.unknown().optional(),
    error: z.string().optional(),
  }),
  z.object({ type: z.literal('peer-joined'), peer: peerSchema }),
  z.object({ type: z.literal('peer-left'), peerId: z.string() }),
  /** Someone started sending; the client may `consume` it. */
  z.object({
    type: z.literal('new-producer'),
    peerId: z.string(),
    producerId: z.string(),
    kind: z.enum(['audio', 'video']),
    /** Video: which of the screen's streams (see `produce`). */
    screenLayer: screenLayerSchema.optional(),
    /** Audio: the sharer's computer sound, played with the screen (#41). */
    screenAudio: z.boolean().optional(),
  }),
  /** To a viewer: which of the screen's streams the host sends them now (#34). */
  z.object({ type: z.literal('screen-layer'), layer: screenLayerSchema }),
  /** Someone started or stopped sharing a screen (only one at a time). */
  z.object({ type: z.literal('screen-share-started'), peerId: z.string() }),
  z.object({ type: z.literal('screen-share-stopped'), peerId: z.string() }),
  /** To the sharer: someone wants to show theirs. */
  z.object({ type: z.literal('screen-request'), fromPeerId: z.string() }),
  /** To the one who asked: the sharer gave way or not. */
  z.object({ type: z.literal('screen-request-answer'), accepted: z.boolean() }),
  /** Someone turned their microphone off or on. */
  z.object({ type: z.literal('peer-muted'), peerId: z.string(), muted: z.boolean() }),
  /** Who is speaking now (loud enough), for the frame around their tile; empty in silence. */
  z.object({ type: z.literal('active-speakers'), peerIds: z.array(z.string()).max(16) }),
  /** The producer behind this consumer is gone. */
  z.object({ type: z.literal('consumer-closed'), consumerId: z.string() }),
  /** The host closes the room on purpose (as opposed to the connection dropping). */
  z.object({ type: z.literal('room-closed') }),
])
export type HostMessage = z.infer<typeof hostMessageSchema>

/** Parses a raw WebSocket frame; null for anything that is not valid JSON of the schema. */
export function parseMessage<T>(schema: z.ZodType<T>, data: unknown): T | null {
  if (typeof data !== 'string') return null
  try {
    const parsed = schema.safeParse(JSON.parse(data))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
