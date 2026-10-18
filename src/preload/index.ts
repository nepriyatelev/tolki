import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  EventChannel,
  EventContract,
  InvokeChannel,
  InvokeContract,
  TolkiApi,
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

const api: TolkiApi = {
  app: {
    getInfo: () => invoke('app:get-info'),
    copyText: (text) => invoke('app:copy-text', text),
    openDownloadPage: () => invoke('app:open-download-page'),
    openLink: (url) => invoke('app:open-link', url),
    checkUpdate: () => invoke('app:check-update'),
    installUpdate: () => invoke('app:install-update'),
    relaunch: () => invoke('app:relaunch'),
    onUpdate: (listener) => subscribe('app:update', listener),
  },
  host: {
    start: (options = {}) => invoke('host:start', options),
    stop: () => invoke('host:stop'),
    getState: () => invoke('host:get-state'),
    getFingerprint: () => invoke('host:get-fingerprint'),
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
    preview: (invite) => invoke('room:preview', invite),
    onClosed: (listener) => subscribe('room:closed', listener),
    join: (request) => invoke('room:join', request),
    leave: () => invoke('room:leave'),
    request: (request) => invoke('room:request', request),
    onEvent: (listener) => subscribe('room:event', listener),
    onWaiting: (listener) =>
      subscribe('room:waiting', () => {
        listener()
      }),
    onReconnecting: (listener) =>
      subscribe('room:reconnecting', () => {
        listener()
      }),
    onReconnected: (listener) => subscribe('room:reconnected', listener),
  },
  recent: {
    list: () => invoke('recent:list'),
    probe: () => invoke('recent:probe'),
    remove: (id) => invoke('recent:remove', id),
  },
  screen: {
    listSources: () => invoke('screen:list-sources'),
    select: (id) => invoke('screen:select', id),
  },
  permissions: {
    status: (kind) => invoke('permissions:status', kind),
    request: (kind) => invoke('permissions:request', kind),
    openSettings: (kind) => invoke('permissions:open-settings', kind),
  },
  ptt: {
    configure: (request) => invoke('ptt:configure', request),
    openPermissionSettings: () => invoke('ptt:open-permission-settings'),
    onKey: (listener) => subscribe('ptt:key', listener),
  },
  tray: {
    update: (state) => invoke('tray:update', state),
    onCommand: (listener) => subscribe('tray:command', listener),
  },
  hotkeys: {
    configure: (request) => invoke('hotkeys:configure', request),
    onPressed: (listener) => subscribe('hotkeys:pressed', listener),
  },
  invite: {
    takePending: () => invoke('invite:take-pending'),
    onOpened: (listener) => subscribe('invite:opened', listener),
  },
}

contextBridge.exposeInMainWorld('tolki', api)
