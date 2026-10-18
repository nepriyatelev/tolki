import { describe, expect, it } from 'vitest'
import type { HostState } from '@shared/host-protocol'
import { parseInvite } from '@shared/invite'
import type { NetworkCheckResult } from '@shared/network'
import { MOCK_FINGERPRINT, PUBLIC_IPV4_CHECK } from '../../../test/tolki-mock'
import { createInviteLink, linkAddress } from './invite-link'

const STOPPED: HostState = { status: 'stopped' }

describe('linkAddress', () => {
  it('uses the forwarded public IPv4 from the network check', () => {
    expect(linkAddress(PUBLIC_IPV4_CHECK, STOPPED)).toEqual({
      host: '93.184.216.34',
      hostKind: 'ipv4',
      port: 47000,
    })
  })

  it("prefers the running room's own mapping (the router may pick another port)", () => {
    const running: HostState = {
      status: 'running',
      port: 47000,
      fingerprint: MOCK_FINGERPRINT,
      portMapping: {
        status: 'mapped',
        method: 'pcp',
        externalAddress: '93.184.216.35',
        externalPort: 51000,
        externalUdpPort: 51000,
      },
    }

    expect(linkAddress(PUBLIC_IPV4_CHECK, running)).toEqual({
      host: '93.184.216.35',
      hostKind: 'ipv4',
      port: 51000,
    })
  })

  it('falls back to the global IPv6 address', () => {
    const check: NetworkCheckResult = {
      ...PUBLIC_IPV4_CHECK,
      ipv6Address: '2a02:6b8::1',
      verdict: { canHost: true, via: 'ipv6', address: '2a02:6b8::1', ipv4Problem: 'cgnat' },
    }

    expect(linkAddress(check, STOPPED)).toEqual({
      host: '2a02:6b8::1',
      hostKind: 'ipv6',
      port: 47000,
    })
  })

  it('has nothing to offer when nobody can reach this computer', () => {
    const check: NetworkCheckResult = {
      ...PUBLIC_IPV4_CHECK,
      verdict: { canHost: false, problem: 'cgnat' },
    }

    expect(linkAddress(check, STOPPED)).toBeNull()
    expect(linkAddress(undefined, STOPPED)).toBeNull()
  })
})

describe('createInviteLink', () => {
  const base = {
    address: { host: '93.184.216.34', hostKind: 'ipv4' as const, port: 47000 },
    roomId: 'abcdefghij',
    fingerprint: MOCK_FINGERPRINT,
    password: 'лиса-маяк-42',
  }

  it('builds a valid invite without the password by default', () => {
    const link = createInviteLink({ ...base, embedPassword: false })

    expect(link).not.toContain('k=')
    expect(parseInvite(link)).toMatchObject({ ok: true, invite: { roomId: 'abcdefghij' } })
  })

  it('embeds the password when asked, but never an empty one', () => {
    expect(parseInvite(createInviteLink({ ...base, embedPassword: true }))).toMatchObject({
      invite: { password: 'лиса-маяк-42' },
    })
    expect(createInviteLink({ ...base, password: '', embedPassword: true })).not.toContain('k=')
  })
})
