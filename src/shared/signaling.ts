import { z } from 'zod'

/**
 * Signalling protocol over WSS between a client and the host (PLAN §5):
 *   hello → challenge {nonce, room} → auth {name, hmac} → welcome | error
 * Every message is JSON validated with these schemas on both ends.
 */

export const PROTOCOL_VERSION = 1

export const errorCodeSchema = z.enum([
  'WRONG_PASSWORD',
  'ROOM_FULL',
  'TOO_MANY_ATTEMPTS',
  'VERSION_MISMATCH',
  'SCREEN_BUSY',
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
})
export type RoomInfo = z.infer<typeof roomInfoSchema>

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), protocolVersion: z.number().int() }),
  z.object({
    type: z.literal('auth'),
    name: peerNameSchema,
    /** base64url HMAC-SHA256; null when the room has no password. */
    hmac: z.string().max(64).nullable(),
  }),
])
export type ClientMessage = z.infer<typeof clientMessageSchema>

export const hostMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('challenge'), nonce: z.string().max(64), room: roomInfoSchema }),
  z.object({ type: z.literal('welcome'), peerId: z.string(), peers: z.array(peerSchema) }),
  z.object({ type: z.literal('error'), code: errorCodeSchema }),
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
