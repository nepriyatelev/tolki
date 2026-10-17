import { findDefaultGateway } from './gateway'
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
  return mapPort(port, strategies, { hasGateway: gateway !== null })
}
