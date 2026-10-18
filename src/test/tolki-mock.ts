import { vi, type Mock } from 'vitest'
import type { InviteParseResult } from '@shared/invite'
import type { TolkiApi } from '@shared/ipc'
import type { NetworkCheckResult } from '@shared/network'
import type { RecentRoom, RecentStatus } from '@shared/recent'
import type { JoinResult, RoomClosedEvent, RoomEvent, RoomPreview } from '@shared/room'
import { DEFAULT_SETTINGS } from '@shared/settings'

export const MOCK_FINGERPRINT = '2_SqXt3l45Ay59VWqBcvcLmeh7BmqvL0m-UwbNw3EiE'

export const PUBLIC_IPV4_CHECK: NetworkCheckResult = {
  checkedAt: 0,
  port: 47000,
  portMapping: {
    status: 'mapped',
    method: 'upnp',
    externalAddress: '93.184.216.34',
    externalPort: 47000,
    externalUdpPort: 47000,
  },
  ipv6Address: null,
  localAddress: '192.168.1.42',
  verdict: {
    canHost: true,
    via: 'ipv4',
    method: 'upnp',
    externalAddress: '93.184.216.34',
    externalPort: 47000,
  },
}

export interface TolkiMock {
  app: {
    copyText: Mock<TolkiApi['app']['copyText']>
    openDownloadPage: Mock<TolkiApi['app']['openDownloadPage']>
    checkUpdate: Mock<TolkiApi['app']['checkUpdate']>
  }
  host: {
    start: Mock<TolkiApi['host']['start']>
    stop: Mock<TolkiApi['host']['stop']>
  }
  network: {
    check: Mock<TolkiApi['network']['check']>
    measureUpload: Mock<TolkiApi['network']['measureUpload']>
  }
  settings: {
    get: Mock<TolkiApi['settings']['get']>
    update: Mock<TolkiApi['settings']['update']>
  }
  recent: {
    list: Mock<TolkiApi['recent']['list']>
    probe: Mock<TolkiApi['recent']['probe']>
    remove: Mock<TolkiApi['recent']['remove']>
  }
  room: {
    preview: Mock<TolkiApi['room']['preview']>
    /** Simulates main reporting that the joined room ended. */
    emitClosed(event: RoomClosedEvent): void
    join: Mock<TolkiApi['room']['join']>
    leave: Mock<TolkiApi['room']['leave']>
    request: Mock<TolkiApi['room']['request']>
    onEvent: Mock<TolkiApi['room']['onEvent']>
    /** Simulates an event of the joined room. */
    emitEvent(event: RoomEvent): void
    /** Simulates main reconnecting, then being back with a new join result. */
    emitReconnecting(): void
    emitReconnected(result: Extract<JoinResult, { ok: true }>): void
  }
  invite: {
    takePending: Mock<TolkiApi['invite']['takePending']>
    /** Simulates main delivering a link while the app is open. */
    emit(result: InviteParseResult): void
  }
}

export interface TolkiMockOptions extends Partial<TolkiApi['network']> {
  /** A newer release main found (PLAN #36). */
  update?: { version: string }
  /** A link that "started the app". */
  pendingInvite?: InviteParseResult
  join?: TolkiApi['room']['join']
  /** Remembered volumes by name (settings.audio.peerVolumes). */
  peerVolumes?: Record<string, number>
  recentRooms?: RecentRoom[]
  recentStatuses?: Record<string, RecentStatus>
  profileName?: string
  hostStart?: TolkiApi['host']['start']
  preview?: RoomPreview
}

export const LIVE_PREVIEW: RoomPreview = {
  status: 'live',
  room: { name: 'Вечерний созвон', peerCount: 2, hasPassword: true },
}

/** Installs a fake preload bridge on window for renderer tests. */
export function installTolkiMock(options: TolkiMockOptions = {}): TolkiMock {
  const inviteListeners = new Set<(result: InviteParseResult) => void>()
  const closedListeners = new Set<(event: RoomClosedEvent) => void>()
  const eventListeners = new Set<(event: RoomEvent) => void>()
  const reconnectingListeners = new Set<() => void>()
  const reconnectedListeners = new Set<(result: Extract<JoinResult, { ok: true }>) => void>()
  let recent = options.recentRooms ?? []
  const api = {
    app: {
      getInfo: vi.fn(() => Promise.resolve({ name: 'Tolki', version: '0.0.0', platform: 'test' })),
      copyText: vi.fn<TolkiApi['app']['copyText']>(() => Promise.resolve(null)),
      openDownloadPage: vi.fn<TolkiApi['app']['openDownloadPage']>(() => Promise.resolve(null)),
      checkUpdate: vi.fn<TolkiApi['app']['checkUpdate']>(() =>
        Promise.resolve(options.update ?? null),
      ),
    },
    host: {
      start: vi.fn<TolkiApi['host']['start']>(
        options.hostStart ??
          (() =>
            Promise.resolve({
              status: 'running',
              port: 47000,
              fingerprint: MOCK_FINGERPRINT,
              portMapping: { status: 'pending' },
            })),
      ),
      stop: vi.fn<TolkiApi['host']['stop']>(() => Promise.resolve({ status: 'stopped' })),
      getState: vi.fn(() => Promise.resolve({ status: 'stopped' as const })),
      onState: vi.fn(() => () => undefined),
      getFingerprint: vi.fn(() => Promise.resolve(MOCK_FINGERPRINT)),
    },
    network: {
      check: vi.fn<TolkiApi['network']['check']>(
        options.check ?? (() => Promise.resolve(PUBLIC_IPV4_CHECK)),
      ),
      measureUpload: vi.fn<TolkiApi['network']['measureUpload']>(
        options.measureUpload ?? (() => Promise.resolve({ status: 'disabled' })),
      ),
    },
    recent: {
      list: vi.fn<TolkiApi['recent']['list']>(() => Promise.resolve(recent)),
      probe: vi.fn<TolkiApi['recent']['probe']>(() =>
        Promise.resolve(options.recentStatuses ?? {}),
      ),
      remove: vi.fn<TolkiApi['recent']['remove']>((id) => {
        recent = recent.filter((r) => r.id !== id)
        return Promise.resolve(recent)
      }),
    },
    settings: {
      get: vi.fn<TolkiApi['settings']['get']>(() =>
        Promise.resolve({
          ...DEFAULT_SETTINGS,
          profile: { name: options.profileName ?? '' },
          audio: { ...DEFAULT_SETTINGS.audio, peerVolumes: options.peerVolumes ?? {} },
        }),
      ),
      update: vi.fn<TolkiApi['settings']['update']>(() => Promise.resolve(DEFAULT_SETTINGS)),
    },
    room: {
      preview: vi.fn<TolkiApi['room']['preview']>(() =>
        Promise.resolve(options.preview ?? LIVE_PREVIEW),
      ),
      onClosed: (listener: (event: RoomClosedEvent) => void) => {
        closedListeners.add(listener)
        return () => closedListeners.delete(listener)
      },
      emitClosed: (event: RoomClosedEvent) => {
        for (const listener of closedListeners) listener(event)
      },
      join: vi.fn<TolkiApi['room']['join']>(
        options.join ??
          (() =>
            Promise.resolve({
              ok: true,
              peerId: 'me',
              peers: [],
              room: { name: 'Комната', peerCount: 0, hasPassword: false },
              routerRtpCapabilities: {},
              mutedPeers: [],
              screenMode: 'auto',
              sharerId: null,
            })),
      ),
      leave: vi.fn<TolkiApi['room']['leave']>(() => Promise.resolve(null)),
      request: vi.fn<TolkiApi['room']['request']>(() =>
        Promise.resolve({ ok: false, error: 'no host in tests' }),
      ),
      onEvent: vi.fn<TolkiApi['room']['onEvent']>((listener) => {
        eventListeners.add(listener)
        return () => eventListeners.delete(listener)
      }),
      emitEvent: (event: RoomEvent) => {
        for (const listener of eventListeners) listener(event)
      },
      onReconnecting: vi.fn<TolkiApi['room']['onReconnecting']>((listener) => {
        reconnectingListeners.add(listener)
        return () => reconnectingListeners.delete(listener)
      }),
      onReconnected: vi.fn<TolkiApi['room']['onReconnected']>((listener) => {
        reconnectedListeners.add(listener)
        return () => reconnectedListeners.delete(listener)
      }),
      emitReconnecting: () => {
        for (const listener of reconnectingListeners) listener()
      },
      emitReconnected: (result: Extract<JoinResult, { ok: true }>) => {
        for (const listener of reconnectedListeners) listener(result)
      },
    },
    invite: {
      takePending: vi.fn<TolkiApi['invite']['takePending']>(() =>
        Promise.resolve(options.pendingInvite ?? null),
      ),
      onOpened: (listener: (result: InviteParseResult) => void) => {
        inviteListeners.add(listener)
        return () => inviteListeners.delete(listener)
      },
      emit: (result: InviteParseResult) => {
        for (const listener of inviteListeners) listener(result)
      },
    },
  }
  Object.defineProperty(window, 'tolki', { value: api, configurable: true })
  return api
}
