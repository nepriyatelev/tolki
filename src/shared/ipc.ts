import { z } from 'zod'
import { hostPortSchema, type HostState } from './host-protocol'
import type { Invite, InviteParseResult } from './invite'
import type { NetworkCheckResult } from './network'
import type { RecentRoom, RecentStatus } from './recent'
import type { JoinResult } from './room'
import { peerNameSchema } from './signaling'
import { settingsPatchSchema, type Settings, type SettingsPatch } from './settings'
import type { UploadMeasurement } from './upload-capacity'

export interface AppInfo {
  name: string
  version: string
  platform: string
}

/** Renderer → main request/response channels (`ipcRenderer.invoke`). */
export interface InvokeContract {
  'app:get-info': { args: []; result: AppInfo }
  /** Copies text to the system clipboard (the sandboxed preload has no clipboard module). */
  'app:copy-text': { args: [text: string]; result: null }
  /** Never throws for expected failures: returns `stopped` with `lastError` instead. */
  'host:start': { args: [options: HostStartRequest]; result: HostState }
  'host:stop': { args: []; result: HostState }
  'host:get-state': { args: []; result: HostState }
  /** This installation's certificate fingerprint, for invite links; creates it if needed. */
  'host:get-fingerprint': { args: []; result: string }
  /** Can this computer host? Cached for a few minutes unless `force`. */
  'network:check': { args: [options: NetworkCheckRequest]; result: NetworkCheckResult }
  /** Upload speed via speed.cloudflare.com; `disabled` when turned off in settings. */
  'network:measure-upload': { args: [options: NetworkCheckRequest]; result: UploadMeasurement }
  'settings:get': { args: []; result: Settings }
  'settings:update': { args: [patch: SettingsPatch]; result: Settings }
  /** An invite link that arrived before the renderer was ready, if any. */
  'invite:take-pending': { args: []; result: InviteParseResult | null }
  /** Connect to a host and authenticate; replaces any current connection. */
  'room:join': { args: [request: JoinRoomRequest]; result: JoinResult }
  'room:leave': { args: []; result: null }
  'recent:list': { args: []; result: RecentRoom[] }
  /** Light check of every recent room: only the number of people, no authentication. */
  'recent:probe': { args: []; result: Record<string, RecentStatus> }
  'recent:remove': { args: [id: string]; result: RecentRoom[] }
}

export interface JoinRoomRequest {
  invite: Invite
  name: string
  /** Typed by the user; the invite's embedded or the saved password is used when absent. */
  password?: string | undefined
  /** Joining from the recent rooms list: lets main use the saved password. */
  recentId?: string | undefined
}

export interface NetworkCheckRequest {
  force?: boolean | undefined
  /** Defaults to DEFAULT_HOST_PORT. */
  port?: number | undefined
}

export interface HostStartRequest {
  /** Defaults to DEFAULT_HOST_PORT. */
  port?: number | undefined
  /** Ask the router to forward the port (PCP / NAT-PMP / UPnP). Defaults to true. */
  portMapping?: boolean | undefined
  roomName?: string | undefined
  /** Empty or absent: no password. */
  password?: string | undefined
}

/** Main → renderer events (`webContents.send`). */
export interface EventContract {
  'host:state': HostState
  /** The user opened a ratatosk:// link (already parsed strictly in main). */
  'invite:opened': InviteParseResult
}

export type InvokeChannel = keyof InvokeContract
export type EventChannel = keyof EventContract

/** Runtime validation of renderer-supplied arguments, checked in main for every call. */
export const invokeArgsSchemas: {
  [K in InvokeChannel]: z.ZodType<InvokeContract[K]['args']>
} = {
  'app:get-info': z.tuple([]),
  'app:copy-text': z.tuple([z.string().max(4096)]),
  'host:start': z.tuple([
    z.strictObject({
      port: hostPortSchema.optional(),
      portMapping: z.boolean().optional(),
      roomName: z.string().trim().min(1).max(64).optional(),
      password: z.string().max(128).optional(),
    }),
  ]),
  'host:stop': z.tuple([]),
  'host:get-state': z.tuple([]),
  'host:get-fingerprint': z.tuple([]),
  'network:check': z.tuple([
    z.strictObject({ force: z.boolean().optional(), port: hostPortSchema.optional() }),
  ]),
  'network:measure-upload': z.tuple([z.strictObject({ force: z.boolean().optional() })]),
  'settings:get': z.tuple([]),
  'settings:update': z.tuple([settingsPatchSchema]),
  'invite:take-pending': z.tuple([]),
  'room:join': z.tuple([
    z.strictObject({
      invite: z.strictObject({
        host: z.string(),
        hostKind: z.enum(['ipv4', 'ipv6', 'dns']),
        port: z.number().int(),
        roomId: z.string(),
        fingerprint: z.string(),
        password: z.string().optional(),
      }),
      name: peerNameSchema,
      password: z.string().max(128).optional(),
      recentId: z.string().max(64).optional(),
    }),
  ]),
  'room:leave': z.tuple([]),
  'recent:list': z.tuple([]),
  'recent:probe': z.tuple([]),
  'recent:remove': z.tuple([z.string().max(64)]),
}

/** The API the preload script exposes to the renderer as `window.ratatosk`. */
export interface RatatoskApi {
  app: {
    getInfo(): Promise<AppInfo>
    copyText(text: string): Promise<null>
  }
  host: {
    start(options?: HostStartRequest): Promise<HostState>
    stop(): Promise<HostState>
    getState(): Promise<HostState>
    getFingerprint(): Promise<string>
    /** Returns an unsubscribe function. */
    onState(listener: (state: HostState) => void): () => void
  }
  network: {
    check(options?: NetworkCheckRequest): Promise<NetworkCheckResult>
    measureUpload(options?: NetworkCheckRequest): Promise<UploadMeasurement>
  }
  settings: {
    get(): Promise<Settings>
    update(patch: SettingsPatch): Promise<Settings>
  }
  room: {
    join(request: JoinRoomRequest): Promise<JoinResult>
    leave(): Promise<null>
  }
  recent: {
    list(): Promise<RecentRoom[]>
    probe(): Promise<Record<string, RecentStatus>>
    remove(id: string): Promise<RecentRoom[]>
  }
  invite: {
    takePending(): Promise<InviteParseResult | null>
    /** Returns an unsubscribe function. */
    onOpened(listener: (result: InviteParseResult) => void): () => void
  }
}
