import { findDefaultGateway, findDefaultRouteInterface, TUNNEL_INTERFACE } from './gateway'
import { mapPort, type PortMappingSession } from './port-mapper'
import { NatPmpStrategy, PcpStrategy, UpnpStrategy, type NatProbe } from './strategies'

/** Asks the router to forward `port` (TCP + UDP): PCP, then NAT-PMP, then UPnP. */
export async function mapHostPort(port: number): Promise<PortMappingSession> {
  const gateway = await findDefaultGateway()
  const probe: NatProbe = {}
  const strategies = [
    ...(gateway ? [new PcpStrategy(gateway, probe), new NatPmpStrategy(gateway, probe)] : []),
    new UpnpStrategy(gateway?.localAddress ?? null),
  ]
  // No router but the default route goes into a tunnel: a VPN captures the traffic (#60).
  const routeInterface = gateway === null ? await findDefaultRouteInterface() : null
  const vpn = routeInterface !== null && TUNNEL_INTERFACE.test(routeInterface)
  return mapPort(port, strategies, { hasGateway: gateway !== null, vpn })
}
