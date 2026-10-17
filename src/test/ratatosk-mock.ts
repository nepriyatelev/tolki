import { vi, type Mock } from 'vitest'
import type { InviteParseResult } from '@shared/invite'
import type { RatatoskApi } from '@shared/ipc'
import type { NetworkCheckResult } from '@shared/network'
import { DEFAULT_SETTINGS } from '@shared/settings'

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
  network: {
    check: Mock<RatatoskApi['network']['check']>
    measureUpload: Mock<RatatoskApi['network']['measureUpload']>
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
}

/** Installs a fake preload bridge on window for renderer tests. */
export function installRatatoskMock(options: RatatoskMockOptions = {}): RatatoskMock {
  const inviteListeners = new Set<(result: InviteParseResult) => void>()
  const api = {
    app: {
      getInfo: vi.fn(() =>
        Promise.resolve({ name: 'Ratatosk', version: '0.0.0', platform: 'test' }),
      ),
    },
    host: {
      start: vi.fn(),
      stop: vi.fn(),
      getState: vi.fn(() => Promise.resolve({ status: 'stopped' as const })),
      onState: vi.fn(() => () => undefined),
    },
    network: {
      check: vi.fn<RatatoskApi['network']['check']>(
        options.check ?? (() => Promise.resolve(PUBLIC_IPV4_CHECK)),
      ),
      measureUpload: vi.fn<RatatoskApi['network']['measureUpload']>(
        options.measureUpload ?? (() => Promise.resolve({ status: 'disabled' })),
      ),
    },
    settings: {
      get: vi.fn(() => Promise.resolve(DEFAULT_SETTINGS)),
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
