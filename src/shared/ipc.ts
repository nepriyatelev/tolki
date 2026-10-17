import { z } from 'zod'
import type { HostStatus } from './host-protocol'

export interface AppInfo {
  name: string
  version: string
  platform: string
}

/** Renderer → main request/response channels (`ipcRenderer.invoke`). */
export interface InvokeContract {
  'app:get-info': { args: []; result: AppInfo }
  'host:start': { args: []; result: HostStatus }
  'host:stop': { args: []; result: HostStatus }
  'host:get-status': { args: []; result: HostStatus }
}

/** Main → renderer events (`webContents.send`). */
export interface EventContract {
  'host:status': HostStatus
}

export type InvokeChannel = keyof InvokeContract
export type EventChannel = keyof EventContract

/** Runtime validation of renderer-supplied arguments, checked in main for every call. */
export const invokeArgsSchemas: {
  [K in InvokeChannel]: z.ZodType<InvokeContract[K]['args']>
} = {
  'app:get-info': z.tuple([]),
  'host:start': z.tuple([]),
  'host:stop': z.tuple([]),
  'host:get-status': z.tuple([]),
}

/** The API the preload script exposes to the renderer as `window.ratatosk`. */
export interface RatatoskApi {
  app: {
    getInfo(): Promise<AppInfo>
  }
  host: {
    start(): Promise<HostStatus>
    stop(): Promise<HostStatus>
    getStatus(): Promise<HostStatus>
    /** Returns an unsubscribe function. */
    onStatus(listener: (status: HostStatus) => void): () => void
  }
}
