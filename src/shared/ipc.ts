import { z } from 'zod'
import { hostPortSchema, type HostState } from './host-protocol'

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
}

export interface HostStartRequest {
  /** Defaults to DEFAULT_HOST_PORT. */
  port?: number | undefined
}

/** Main → renderer events (`webContents.send`). */
export interface EventContract {
  'host:state': HostState
}

export type InvokeChannel = keyof InvokeContract
export type EventChannel = keyof EventContract

/** Runtime validation of renderer-supplied arguments, checked in main for every call. */
export const invokeArgsSchemas: {
  [K in InvokeChannel]: z.ZodType<InvokeContract[K]['args']>
} = {
  'app:get-info': z.tuple([]),
  'host:start': z.tuple([z.strictObject({ port: hostPortSchema.optional() })]),
  'host:stop': z.tuple([]),
  'host:get-state': z.tuple([]),
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
}
