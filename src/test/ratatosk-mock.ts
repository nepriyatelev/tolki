import { vi, type Mock } from 'vitest'
import type { InviteParseResult } from '@shared/invite'
import type { RatatoskApi } from '@shared/ipc'
import type { NetworkCheckResult } from '@shared/network'
import type { RecentRoom, RecentStatus } from '@shared/recent'
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
  verdict: {
    canHost: true,
    via: 'ipv4',
    method: 'upnp',
    externalAddress: '93.184.216.34',
    externalPort: 47000,
  },
}

export interface RatatoskMock {
  app: { copyText: Mock<RatatoskApi['app']['copyText']> }
  host: {
    start: Mock<RatatoskApi['host']['start']>
    stop: Mock<RatatoskApi['host']['stop']>
  }
  network: {
    check: Mock<RatatoskApi['network']['check']>
    measureUpload: Mock<RatatoskApi['network']['measureUpload']>
  }
  recent: {
    list: Mock<RatatoskApi['recent']['list']>
    probe: Mock<RatatoskApi['recent']['probe']>
    remove: Mock<RatatoskApi['recent']['remove']>
  }
  room: {
    join: Mock<RatatoskApi['room']['join']>
    leave: Mock<RatatoskApi['room']['leave']>
  }
  invite: {
    takePending: Mock<RatatoskApi['invite']['takePending']>
    /** Simulates main delivering a link while the app is open. */
    emit(result: InviteParseResult): void
  }
}

export interface RatatoskMockOptions extends Partial<RatatoskApi['network']> {
  /** A link that "started the app". */
  pendingInvite?: InviteParseResult
  join?: RatatoskApi['room']['join']
  recentRooms?: RecentRoom[]
  recentStatuses?: Record<string, RecentStatus>
  profileName?: string
  hostStart?: RatatoskApi['host']['start']
}

/** Installs a fake preload bridge on window for renderer tests. */
export function installRatatoskMock(options: RatatoskMockOptions = {}): RatatoskMock {
  const inviteListeners = new Set<(result: InviteParseResult) => void>()
  let recent = options.recentRooms ?? []
  const api = {
    app: {
      getInfo: vi.fn(() =>
        Promise.resolve({ name: 'Ratatosk', version: '0.0.0', platform: 'test' }),
      ),
      copyText: vi.fn<RatatoskApi['app']['copyText']>(() => Promise.resolve(null)),
    },
    host: {
      start: vi.fn<RatatoskApi['host']['start']>(
        options.hostStart ??
          (() =>
            Promise.resolve({
              status: 'running',
              port: 47000,
              fingerprint: MOCK_FINGERPRINT,
              portMapping: { status: 'pending' },
            })),
      ),
      stop: vi.fn<RatatoskApi['host']['stop']>(() => Promise.resolve({ status: 'stopped' })),
      getState: vi.fn(() => Promise.resolve({ status: 'stopped' as const })),
      onState: vi.fn(() => () => undefined),
      getFingerprint: vi.fn(() => Promise.resolve(MOCK_FINGERPRINT)),
    },
    network: {
      check: vi.fn<RatatoskApi['network']['check']>(
        options.check ?? (() => Promise.resolve(PUBLIC_IPV4_CHECK)),
      ),
      measureUpload: vi.fn<RatatoskApi['network']['measureUpload']>(
        options.measureUpload ?? (() => Promise.resolve({ status: 'disabled' })),
      ),
    },
    recent: {
      list: vi.fn<RatatoskApi['recent']['list']>(() => Promise.resolve(recent)),
      probe: vi.fn<RatatoskApi['recent']['probe']>(() =>
        Promise.resolve(options.recentStatuses ?? {}),
      ),
      remove: vi.fn<RatatoskApi['recent']['remove']>((id) => {
        recent = recent.filter((r) => r.id !== id)
        return Promise.resolve(recent)
      }),
    },
    settings: {
      get: vi.fn(() =>
        Promise.resolve({ ...DEFAULT_SETTINGS, profile: { name: options.profileName ?? '' } }),
      ),
      update: vi.fn(() => Promise.resolve(DEFAULT_SETTINGS)),
    },
    room: {
      join: vi.fn<RatatoskApi['room']['join']>(
        options.join ??
          (() =>
            Promise.resolve({
              ok: true,
              peerId: 'me',
              peers: [],
              room: { name: 'Комната', peerCount: 0, hasPassword: false },
            })),
      ),
      leave: vi.fn<RatatoskApi['room']['leave']>(() => Promise.resolve(null)),
    },
    invite: {
      takePending: vi.fn<RatatoskApi['invite']['takePending']>(() =>
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
  Object.defineProperty(window, 'ratatosk', { value: api, configurable: true })
  return api
}
