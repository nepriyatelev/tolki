import { describe, expect, it } from 'vitest'
import type { PortMappingMethod } from '@shared/host-protocol'
import {
  mapPort,
  MethodUnavailableError,
  type MappedPort,
  type MappingStrategy,
} from './port-mapper'
import { NatPmpStrategy } from './strategies'

class FakeStrategy implements MappingStrategy {
  closed = 0
  mappedPort: number | null = null

  constructor(
    readonly method: PortMappingMethod,
    private readonly outcome: 'ok' | 'unavailable' | 'refused',
  ) {}

  map(port: number): Promise<MappedPort> {
    if (this.outcome === 'unavailable') {
      return Promise.reject(new MethodUnavailableError(`${this.method} not here`))
    }
    if (this.outcome === 'refused') return Promise.reject(new Error('conflict'))
    this.mappedPort = port
    return Promise.resolve({
      externalAddress: '203.0.113.5',
      externalPort: port,
      externalUdpPort: port,
    })
  }

  close(): Promise<void> {
    this.closed++
    return Promise.resolve()
  }
}

describe('mapPort', () => {
  it('uses the first method that works and closes the ones that did not', async () => {
    const pcp = new FakeStrategy('pcp', 'unavailable')
    const pmp = new FakeStrategy('nat-pmp', 'unavailable')
    const upnp = new FakeStrategy('upnp', 'ok')

    const session = await mapPort(47000, [pcp, pmp, upnp], { hasGateway: true })

    expect(session.state).toEqual({
      status: 'mapped',
      method: 'upnp',
      externalAddress: '203.0.113.5',
      externalPort: 47000,
      externalUdpPort: 47000,
    })
    expect(pcp.closed).toBe(1)
    expect(pmp.closed).toBe(1)
    expect(upnp.closed).toBe(0)

    await session.close()
    expect(upnp.closed).toBe(1)
  })

  it('keeps trying after a refusal (some routers deny PCP but allow UPnP)', async () => {
    const pcp = new FakeStrategy('pcp', 'refused')
    const upnp = new FakeStrategy('upnp', 'ok')

    const session = await mapPort(47000, [pcp, upnp], { hasGateway: true })

    expect(session.state).toMatchObject({ status: 'mapped', method: 'upnp' })
  })

  it('reports refused with details when every responding router said no', async () => {
    const session = await mapPort(
      47000,
      [new FakeStrategy('pcp', 'refused'), new FakeStrategy('upnp', 'unavailable')],
      { hasGateway: true },
    )

    expect(session.state).toEqual({ status: 'failed', reason: 'refused', detail: 'pcp: conflict' })
  })

  it('reports unsupported when the router speaks none of the protocols', async () => {
    const session = await mapPort(
      47000,
      [new FakeStrategy('pcp', 'unavailable'), new FakeStrategy('upnp', 'unavailable')],
      { hasGateway: true },
    )

    expect(session.state).toMatchObject({ status: 'failed', reason: 'unsupported' })
    await expect(session.close()).resolves.toBeUndefined()
  })

  it('reports no-gateway when there is no default route', async () => {
    const session = await mapPort(47000, [new FakeStrategy('upnp', 'unavailable')], {
      hasGateway: false,
    })

    expect(session.state).toMatchObject({ status: 'failed', reason: 'no-gateway' })
  })
})

describe('NatPmpStrategy', () => {
  it('skips NAT-PMP when PCP got no answer on port 5351', async () => {
    const strategy = new NatPmpStrategy(
      { gateway: '127.0.0.1', localAddress: '127.0.0.1' },
      {
        pcp: 'no-response',
      },
    )

    await expect(strategy.map(47000)).rejects.toBeInstanceOf(MethodUnavailableError)
  })
})
