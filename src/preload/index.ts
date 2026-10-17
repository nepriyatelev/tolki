import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  EventChannel,
  EventContract,
  InvokeChannel,
  InvokeContract,
  RatatoskApi,
} from '@shared/ipc'

// Only explicit, typed methods are exposed; the renderer never gets ipcRenderer itself.

function invoke<K extends InvokeChannel>(
  channel: K,
  ...args: InvokeContract[K]['args']
): Promise<InvokeContract[K]['result']> {
  return ipcRenderer.invoke(channel, ...args) as Promise<InvokeContract[K]['result']>
}

function subscribe<K extends EventChannel>(
  channel: K,
  listener: (payload: EventContract[K]) => void,
): () => void {
  const handler = (_event: IpcRendererEvent, payload: EventContract[K]): void => {
    listener(payload)
  }
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api: RatatoskApi = {
  app: {
    getInfo: () => invoke('app:get-info'),
  },
  host: {
    start: (options = {}) => invoke('host:start', options),
    stop: () => invoke('host:stop'),
    getState: () => invoke('host:get-state'),
    onState: (listener) => subscribe('host:state', listener),
  },
  network: {
    check: (options = {}) => invoke('network:check', options),
    measureUpload: (options = {}) => invoke('network:measure-upload', options),
  },
  settings: {
    get: () => invoke('settings:get'),
    update: (patch) => invoke('settings:update', patch),
  },
  room: {
    join: (request) => invoke('room:join', request),
    leave: () => invoke('room:leave'),
  },
  recent: {
    list: () => invoke('recent:list'),
    probe: () => invoke('recent:probe'),
    remove: (id) => invoke('recent:remove', id),
  },
  invite: {
    takePending: () => invoke('invite:take-pending'),
    onOpened: (listener) => subscribe('invite:opened', listener),
  },
}

contextBridge.exposeInMainWorld('ratatosk', api)
