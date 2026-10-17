import { z } from 'zod'

export const DEFAULT_HOST_PORT = 47000

/** Ports below 1024 need root on Linux/macOS; the host never asks for elevation. */
export const hostPortSchema = z.number().int().min(1024).max(65535)

/** Lifecycle of the `host` utility process as seen by the main process. */
export const hostStatusSchema = z.enum(['stopped', 'starting', 'running', 'stopping'])
export type HostStatus = z.infer<typeof hostStatusSchema>

/** Why the host could not start; shown to the user in plain words. */
export type HostStartFailure = 'port-in-use' | 'port-forbidden' | 'timeout' | 'crashed' | 'unknown'

export const portMappingStateSchema = z.discriminatedUnion('status', [
  /** The user turned automatic forwarding off (e.g. they forwarded the port by hand). */
  z.object({ status: z.literal('disabled') }),
  z.object({ status: z.literal('pending') }),
  z.object({
    status: z.literal('mapped'),
    method: z.enum(['pcp', 'nat-pmp', 'upnp']),
    externalAddress: z.string(),
    externalPort: z.number().int(),
    externalUdpPort: z.number().int(),
  }),
  z.object({
    status: z.literal('failed'),
    reason: z.enum(['no-gateway', 'unsupported', 'refused']),
    detail: z.string(),
  }),
])
export type PortMappingState = z.infer<typeof portMappingStateSchema>
export type PortMappingMethod = Extract<PortMappingState, { status: 'mapped' }>['method']

export type HostState =
  | { status: 'stopped'; lastError?: HostStartFailure }
  | { status: 'starting' | 'stopping'; port: number }
  | { status: 'running'; port: number; fingerprint: string; portMapping: PortMappingState }

/** Messages from main to the `host` utility process. */
export type MainToHostMessage =
  | {
      type: 'start'
      port: number
      dataDir: string
      portMapping: boolean
      roomName: string
      /** Empty: no password. Stays in memory only. */
      password: string
    }
  /** One-shot network check: try to forward the port, report, remove the mapping, exit. */
  | { type: 'check'; port: number }
  | { type: 'shutdown' }

/** Messages from the `host` utility process to main. */
export const hostToMainMessageSchema = z.discriminatedUnion('type', [
  /** Signalling server is listening. */
  z.object({ type: z.literal('ready'), port: hostPortSchema, fingerprint: z.string() }),
  /** Server could not start; the process exits right after. */
  z.object({
    type: z.literal('start-failed'),
    reason: z.enum(['port-in-use', 'port-forbidden', 'unknown']),
    message: z.string(),
  }),
  /** Result of automatic port forwarding, sent after `ready`. */
  z.object({ type: z.literal('port-mapping'), state: portMappingStateSchema }),
  /** Answer to `check`; the process exits right after. */
  z.object({ type: z.literal('check-result'), portMapping: portMappingStateSchema }),
  /** Sent right before the process exits on an unrecoverable error. */
  z.object({ type: z.literal('fatal'), message: z.string() }),
])
export type HostToMainMessage = z.infer<typeof hostToMainMessageSchema>
