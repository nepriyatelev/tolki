import { z } from 'zod'
import { hostPortSchema, type HostState } from './host-protocol'
import type { InviteParseResult } from './invite'
import type { NetworkCheckResult } from './network'
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
  /** Never throws for expected failures: returns `stopped` with `lastError` instead. */
  'host:start': { args: [options: HostStartRequest]; result: HostState }
  'host:stop': { args: []; result: HostState }
  'host:get-state': { args: []; result: HostState }
  /** Can this computer host? Cached for a few minutes unless `force`. */
  'network:check': { args: [options: NetworkCheckRequest]; result: NetworkCheckResult }
  /** Upload speed via speed.cloudflare.com; `disabled` when turned off in settings. */
  'network:measure-upload': { args: [options: NetworkCheckRequest]; result: UploadMeasurement }
  'settings:get': { args: []; result: Settings }
  'settings:update': { args: [patch: SettingsPatch]; result: Settings }
  /** An invite link that arrived before the renderer was ready, if any. */
  'invite:take-pending': { args: []; result: InviteParseResult | null }
}

export interface NetworkCheckRequest {
  force?: boolean | undefined
}

export interface HostStartRequest {
  /** Defaults to DEFAULT_HOST_PORT. */
  port?: number | undefined
  /** Ask the router to forward the port (PCP / NAT-PMP / UPnP). Defaults to true. */
  portMapping?: boolean | undefined
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
  'host:start': z.tuple([
    z.strictObject({ port: hostPortSchema.optional(), portMapping: z.boolean().optional() }),
  ]),
  'host:stop': z.tuple([]),
  'host:get-state': z.tuple([]),
  'network:check': z.tuple([z.strictObject({ force: z.boolean().optional() })]),
  'network:measure-upload': z.tuple([z.strictObject({ force: z.boolean().optional() })]),
  'settings:get': z.tuple([]),
  'settings:update': z.tuple([settingsPatchSchema]),
  'invite:take-pending': z.tuple([]),
}

/** The API the preload script exposes to the renderer as `window.ratatosk`. */
export interface RatatoskApi {
  app: {
    getInfo(): Promise<AppInfo>
  }
  host: {
    start(options?: HostStartRequest): Promise<HostState>
    stop(): Promise<HostState>
    getState(): Promise<HostState>
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
  invite: {
    takePending(): Promise<InviteParseResult | null>
    /** Returns an unsubscribe function. */
    onOpened(listener: (result: InviteParseResult) => void): () => void
  }
}
