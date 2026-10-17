import type { PortMappingMethod, PortMappingState } from './host-protocol'

export type IPv4Class = 'public' | 'private' | 'cgnat' | 'reserved'

/** Classifies an IPv4 address by whether it is reachable from the internet. */
export function classifyIPv4(address: string): IPv4Class {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return 'reserved'
  }
  const [a = 0, b = 0] = parts
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'private'
  // 100.64.0.0/10: carrier-grade NAT (RFC 6598).
  if (a === 100 && b >= 64 && b <= 127) return 'cgnat'
  if (
    a === 0 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 192 && b === 0) || // 192.0.0.0/24 and 192.0.2.0/24
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) || // 198.51.100.0/24
    (a === 203 && b === 0) || // 203.0.113.0/24
    a >= 224
  ) {
    return 'reserved'
  }
  return 'public'
}

/** True for a global unicast IPv6 address (2000::/3) other than documentation and Teredo. */
export function isGlobalIPv6(address: string): boolean {
  const lower = address.toLowerCase().split('%')[0] ?? ''
  const firstHextet = parseInt(lower.split(':')[0] ?? '', 16)
  if (Number.isNaN(firstHextet) || (firstHextet & 0xe000) !== 0x2000) return false
  if (lower.startsWith('2001:db8:') || lower.startsWith('2001:0db8:')) return false
  if (/^2001:0?:/.test(lower)) return false // Teredo 2001::/32
  return true
}

export type HostingVerdict =
  | {
      canHost: true
      via: 'ipv4'
      method: PortMappingMethod
      externalAddress: string
      externalPort: number
    }
  | { canHost: true; via: 'ipv6'; address: string; ipv4Problem: HostingProblem }
  | { canHost: false; problem: HostingProblem }

export type HostingProblem =
  | 'cgnat'
  | 'double-nat'
  | 'no-gateway'
  | 'unsupported'
  | 'refused'
  | 'bad-address'
  | 'mapping-disabled'

/**
 * Heuristic from PLAN #9: a host is reachable if the router forwarded the port and its external
 * IPv4 is public (not RFC 1918, not CGNAT), or if the machine has a global IPv6 address.
 */
export function assessHosting(input: {
  portMapping: PortMappingState
  ipv6Address: string | null
}): HostingVerdict {
  const ipv4 = assessIPv4(input.portMapping)
  if (ipv4.canHost) return ipv4
  if (input.ipv6Address !== null && isGlobalIPv6(input.ipv6Address)) {
    return { canHost: true, via: 'ipv6', address: input.ipv6Address, ipv4Problem: ipv4.problem }
  }
  return ipv4
}

function assessIPv4(
  mapping: PortMappingState,
): Extract<HostingVerdict, { via: 'ipv4' }> | { canHost: false; problem: HostingProblem } {
  switch (mapping.status) {
    case 'disabled':
    case 'pending':
      return { canHost: false, problem: 'mapping-disabled' }
    case 'failed':
      return { canHost: false, problem: mapping.reason }
    case 'mapped':
      switch (classifyIPv4(mapping.externalAddress)) {
        case 'public':
          return {
            canHost: true,
            via: 'ipv4',
            method: mapping.method,
            externalAddress: mapping.externalAddress,
            externalPort: mapping.externalPort,
          }
        case 'cgnat':
          return { canHost: false, problem: 'cgnat' }
        case 'private':
          // Our router got a private address from another router upstream.
          return { canHost: false, problem: 'double-nat' }
        case 'reserved':
          return { canHost: false, problem: 'bad-address' }
      }
  }
}

export interface NetworkCheckResult {
  /** Unix ms. */
  checkedAt: number
  port: number
  portMapping: PortMappingState
  ipv6Address: string | null
  verdict: HostingVerdict
}
