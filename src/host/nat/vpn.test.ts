import { describe, expect, it } from 'vitest'
import { parseLinuxDefaultInterface, parseMacDefaultInterface, TUNNEL_INTERFACE } from './gateway'
import { mapPort, MethodUnavailableError, type MappingStrategy } from './port-mapper'

describe('VPN detection (#60)', () => {
  it('reads the default route interface on macOS', () => {
    expect(parseMacDefaultInterface('   route to: default\n  interface: utun6\n')).toBe('utun6')
    expect(parseMacDefaultInterface('nothing')).toBeNull()
  })

  it('reads the default route interface on Linux (lowest metric)', () => {
    const table = [
      'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask',
      'wlan0\t00000000\t0101A8C0\t0003\t0\t0\t600\t00000000',
      'wg0\t00000000\t00000000\t0001\t0\t0\t50\t00000000',
    ].join('\n')

    expect(parseLinuxDefaultInterface(table)).toBe('wg0')
  })

  it.each(['utun6', 'tun0', 'wg0', 'ppp0', 'ipsec0', 'tailscale0'])('%s is a tunnel', (name) => {
    expect(TUNNEL_INTERFACE.test(name)).toBe(true)
  })

  it.each(['en0', 'eth0', 'wlan0', 'Ethernet'])('%s is not a tunnel', (name) => {
    expect(TUNNEL_INTERFACE.test(name)).toBe(false)
  })

  it('reports vpn instead of no-gateway when the default route goes into a tunnel', async () => {
    const upnp: MappingStrategy = {
      method: 'upnp',
      map: () => Promise.reject(new MethodUnavailableError('none')),
      close: () => Promise.resolve(),
    }

    expect((await mapPort(47000, [upnp], { hasGateway: false, vpn: true })).state).toMatchObject({
      status: 'failed',
      reason: 'vpn',
    })
    expect((await mapPort(47000, [upnp], { hasGateway: false })).state).toMatchObject({
      reason: 'no-gateway',
    })
  })
})
