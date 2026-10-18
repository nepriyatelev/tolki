import { describe, expect, it } from 'vitest'
import type { PortMappingState } from './host-protocol'
import { assessHosting, classifyIPv4, isGlobalIPv6 } from './network'

describe('classifyIPv4', () => {
  it.each([
    ['93.184.216.34', 'public'],
    ['8.8.8.8', 'public'],
    ['172.15.0.1', 'public'],
    ['172.32.0.1', 'public'],
    ['100.63.255.255', 'public'],
    ['100.128.0.1', 'public'],
    ['10.0.0.1', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['192.168.1.1', 'private'],
    ['100.64.0.1', 'cgnat'],
    ['100.127.255.254', 'cgnat'],
    ['0.0.0.0', 'reserved'],
    ['127.0.0.1', 'reserved'],
    ['169.254.10.20', 'reserved'],
    ['203.0.113.5', 'reserved'],
    ['224.0.0.1', 'reserved'],
    ['', 'reserved'],
    ['1.2.3', 'reserved'],
    ['1.2.3.256', 'reserved'],
  ] as const)('%s is %s', (address, expected) => {
    expect(classifyIPv4(address)).toBe(expected)
  })
})

describe('isGlobalIPv6', () => {
  it.each([
    ['2a02:6b8::feed:0ff', true],
    ['2001:4860:4860::8888', true],
    ['2606:4700::1111%en0', true],
    ['fe80::1', false],
    ['fd12:3456::1', false],
    ['::1', false],
    ['2001:db8::1', false],
    ['2001:0:53aa:64c::1', false],
    ['3fff::1', true],
    ['not an address', false],
  ] as const)('%s → %s', (address, expected) => {
    expect(isGlobalIPv6(address)).toBe(expected)
  })
})

describe('assessHosting', () => {
  const mapped = (externalAddress: string): PortMappingState => ({
    status: 'mapped',
    method: 'upnp',
    externalAddress,
    externalPort: 47000,
    externalUdpPort: 47000,
  })

  it('can host when the port is forwarded and the external IPv4 is public', () => {
    expect(assessHosting({ portMapping: mapped('93.184.216.34'), ipv6Address: null })).toEqual({
      canHost: true,
      via: 'ipv4',
      method: 'upnp',
      externalAddress: '93.184.216.34',
      externalPort: 47000,
    })
  })

  it('cannot host behind carrier-grade NAT', () => {
    expect(assessHosting({ portMapping: mapped('100.72.1.2'), ipv6Address: null })).toEqual({
      canHost: false,
      problem: 'cgnat',
    })
  })

  it('cannot host behind a second router (private external address)', () => {
    expect(assessHosting({ portMapping: mapped('192.168.0.2'), ipv6Address: null })).toEqual({
      canHost: false,
      problem: 'double-nat',
    })
  })

  it('passes the mapping failure reason through', () => {
    const portMapping: PortMappingState = { status: 'failed', reason: 'unsupported', detail: '' }

    expect(assessHosting({ portMapping, ipv6Address: null })).toEqual({
      canHost: false,
      problem: 'unsupported',
    })
  })

  it('can host over IPv6 when IPv4 does not work', () => {
    expect(
      assessHosting({ portMapping: mapped('100.72.1.2'), ipv6Address: '2a02:6b8::1' }),
    ).toEqual({ canHost: true, via: 'ipv6', address: '2a02:6b8::1', ipv4Problem: 'cgnat' })
  })

  it('prefers IPv4 when both work', () => {
    expect(
      assessHosting({ portMapping: mapped('93.184.216.34'), ipv6Address: '2a02:6b8::1' }),
    ).toMatchObject({ canHost: true, via: 'ipv4' })
  })

  it('ignores non-global IPv6 addresses', () => {
    expect(assessHosting({ portMapping: { status: 'disabled' }, ipv6Address: 'fd00::1' })).toEqual({
      canHost: false,
      problem: 'mapping-disabled',
    })
  })
})
describe('assessHosting from outside (#128)', () => {
  const unsupported: PortMappingState = { status: 'failed', reason: 'unsupported', detail: '' }
  const mapped = (externalAddress: string): PortMappingState => ({
    status: 'mapped',
    method: 'upnp',
    externalAddress,
    externalPort: 47000,
    externalUdpPort: 47000,
  })

  it('a port forwarded by hand that answers from outside: host via the STUN address', () => {
    expect(
      assessHosting({
        portMapping: unsupported,
        ipv6Address: null,
        stunAddress: '93.184.216.34',
        reachability: 'reachable',
        port: 47000,
      }),
    ).toEqual({
      canHost: true,
      via: 'ipv4',
      method: 'manual',
      externalAddress: '93.184.216.34',
      externalPort: 47000,
    })
  })

  it('a port closed from outside is said so; an unknown answer keeps the router’s reason', () => {
    const base = { portMapping: unsupported, ipv6Address: null, stunAddress: '93.184.216.34' }
    expect(assessHosting({ ...base, reachability: 'closed', port: 47000 })).toEqual({
      canHost: false,
      problem: 'closed',
    })
    expect(assessHosting({ ...base, reachability: 'unknown', port: 47000 })).toEqual({
      canHost: false,
      problem: 'unsupported',
    })
  })

  it('a router’s public address that the outside does not see means another NAT upstream', () => {
    expect(
      assessHosting({
        portMapping: mapped('93.184.216.34'),
        ipv6Address: null,
        stunAddress: '93.184.216.99',
      }),
    ).toEqual({ canHost: false, problem: 'double-nat' })
    expect(
      assessHosting({
        portMapping: mapped('93.184.216.34'),
        ipv6Address: null,
        stunAddress: '93.184.216.34',
      }).canHost,
    ).toBe(true)
  })

  it('reachability does not override a VPN; a private STUN answer is not trusted', () => {
    expect(
      assessHosting({
        portMapping: { status: 'failed', reason: 'vpn', detail: '' },
        ipv6Address: null,
        stunAddress: '93.184.216.34',
        reachability: 'reachable',
        port: 47000,
      }),
    ).toEqual({ canHost: false, problem: 'vpn' })
    expect(
      assessHosting({
        portMapping: unsupported,
        ipv6Address: null,
        stunAddress: '192.168.1.5',
        reachability: 'reachable',
        port: 47000,
      }).canHost,
    ).toBe(false)
  })
})
