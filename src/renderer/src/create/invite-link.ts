import type { HostState } from '@shared/host-protocol'
import { buildInvite, type Invite } from '@shared/invite'
import { classifyIPv4, type NetworkCheckResult } from '@shared/network'

export type LinkAddress = Pick<Invite, 'host' | 'hostKind' | 'port'>

/**
 * Address friends connect to: the forwarded public IPv4 (from the running room if it is open,
 * otherwise from the network check), or the global IPv6 address. Null when there is none.
 */
export function linkAddress(
  check: NetworkCheckResult | undefined,
  host: HostState,
): LinkAddress | null {
  if (
    host.status === 'running' &&
    host.portMapping.status === 'mapped' &&
    classifyIPv4(host.portMapping.externalAddress) === 'public'
  ) {
    return {
      host: host.portMapping.externalAddress,
      hostKind: 'ipv4',
      port: host.portMapping.externalPort,
    }
  }
  if (check === undefined || !check.verdict.canHost) return null
  const port = host.status === 'running' ? host.port : check.port
  return check.verdict.via === 'ipv4'
    ? { host: check.verdict.externalAddress, hostKind: 'ipv4', port: check.verdict.externalPort }
    : { host: check.verdict.address.split('%')[0] ?? '', hostKind: 'ipv6', port }
}

export function createInviteLink(options: {
  address: LinkAddress
  roomId: string
  fingerprint: string
  password: string
  embedPassword: boolean
}): string {
  return buildInvite({
    ...options.address,
    roomId: options.roomId,
    fingerprint: options.fingerprint,
    ...(options.embedPassword && options.password !== '' ? { password: options.password } : {}),
  })
}
