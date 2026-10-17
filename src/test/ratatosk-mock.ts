import { vi, type Mock } from 'vitest'
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
}

/** Installs a fake preload bridge on window for renderer tests. */
export function installRatatoskMock(overrides: Partial<RatatoskApi['network']> = {}): RatatoskMock {
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
        overrides.check ?? (() => Promise.resolve(PUBLIC_IPV4_CHECK)),
      ),
      measureUpload: vi.fn<RatatoskApi['network']['measureUpload']>(
        overrides.measureUpload ?? (() => Promise.resolve({ status: 'disabled' })),
      ),
    },
    settings: {
      get: vi.fn(() => Promise.resolve(DEFAULT_SETTINGS)),
      update: vi.fn(() => Promise.resolve(DEFAULT_SETTINGS)),
    },
  }
  Object.defineProperty(window, 'ratatosk', { value: api, configurable: true })
  return api
}
