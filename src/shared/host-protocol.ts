import { z } from 'zod'

/** Lifecycle of the `host` utility process as seen by the main process. */
export const hostStatusSchema = z.enum(['stopped', 'starting', 'running', 'stopping'])
export type HostStatus = z.infer<typeof hostStatusSchema>

/** Messages from main to the `host` utility process. */
export type MainToHostMessage = { type: 'shutdown' }

/** Messages from the `host` utility process to main. */
export const hostToMainMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  /** Sent right before the process exits on an unrecoverable error. */
  z.object({ type: z.literal('fatal'), message: z.string() }),
])
export type HostToMainMessage = z.infer<typeof hostToMainMessageSchema>
