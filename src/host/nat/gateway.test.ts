import { describe, expect, it } from 'vitest'
import { parseLinuxRouteTable, parseMacRouteGet, parseWindowsRoutePrint } from './gateway'

describe('parseLinuxRouteTable', () => {
  const header =
    'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT'

  it('reads the default gateway (little-endian hex)', () => {
    const table = [
      header,
      'eth0\t00000000\t0101A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0',
      'eth0\t0001A8C0\t00000000\t0001\t0\t0\t100\t00FFFFFF\t0\t0\t0',
    ].join('\n')

    expect(parseLinuxRouteTable(table)).toBe('192.168.1.1')
  })

  it('prefers the lowest metric when there are several default routes', () => {
    const table = [
      header,
      'wlan0\t00000000\t0100000A\t0003\t0\t0\t600\t00000000\t0\t0\t0',
      'eth0\t00000000\t0101A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0',
    ].join('\n')

    expect(parseLinuxRouteTable(table)).toBe('192.168.1.1')
  })

  it('ignores routes without the gateway flag and returns null without a default route', () => {
    const table = [header, 'tun0\t00000000\t00000000\t0001\t0\t0\t0\t00000000\t0\t0\t0'].join('\n')

    expect(parseLinuxRouteTable(table)).toBeNull()
    expect(parseLinuxRouteTable(header)).toBeNull()
  })
})

describe('parseMacRouteGet', () => {
  it('reads the gateway line', () => {
    const output = `   route to: default
destination: default
       mask: default
    gateway: 192.168.0.1
  interface: en0
      flags: <UP,GATEWAY,DONE,STATIC,PRCLONING>
`
    expect(parseMacRouteGet(output)).toBe('192.168.0.1')
  })

  it('returns null for a non-IPv4 gateway or none', () => {
    expect(parseMacRouteGet('    gateway: link#14\n')).toBeNull()
    expect(parseMacRouteGet('route: writing to routing socket: not in table\n')).toBeNull()
  })
})

describe('parseWindowsRoutePrint', () => {
  const output = [
    '===========================================================================',
    'IPv4 Route Table',
    '===========================================================================',
    'Active Routes:',
    'Network Destination        Netmask          Gateway       Interface  Metric',
    '          0.0.0.0          0.0.0.0      192.168.1.1    192.168.1.42     35',
    '          0.0.0.0          0.0.0.0         On-link       10.8.0.6        5',
    '          0.0.0.0          0.0.0.0        10.0.0.1       10.0.0.17     50',
    '===========================================================================',
    'Persistent Routes:',
    '  None',
  ].join('\r\n')

  it('picks the lowest-metric default route with a real gateway', () => {
    expect(parseWindowsRoutePrint(output)).toBe('192.168.1.1')
  })

  it('returns null without a default route', () => {
    expect(parseWindowsRoutePrint('Active Routes:\r\nNone\r\n')).toBeNull()
  })
})
