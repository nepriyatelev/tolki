import type { NetworkCheckResult } from '@shared/network'
import type { UploadMeasurement } from '@shared/upload-capacity'

// One line per event for the logs (#106). Addresses are written as they are: LogPrivacy masks
// them on the way into the file, keeping the kind of address.

export function networkCheckLine(result: NetworkCheckResult): string {
  const { portMapping: m, verdict: v } = result
  const mapping =
    m.status === 'mapped'
      ? `mapped via ${m.method}, external ${m.externalAddress}:${m.externalPort}`
      : m.status === 'failed'
        ? `failed (${m.reason})`
        : m.status
  const verdict = v.canHost
    ? v.via === 'ipv4'
      ? `can host via ${v.method}`
      : `can host via IPv6 only (IPv4: ${v.ipv4Problem})`
    : `cannot host: ${v.problem}`
  return (
    `network check: port ${result.port}, mapping ${mapping}, ` +
    `local ${result.localAddress ?? 'unknown'}, IPv6 ${result.ipv6Address ?? 'none'}, ` +
    `router ${result.gateway ?? 'unknown'}, seen from outside ${result.stunAddress ?? 'unknown'}, ` +
    `port check ${result.reachability} → ${verdict}`
  )
}

export function uploadLine(measurement: UploadMeasurement): string {
  switch (measurement.status) {
    case 'disabled':
      return 'upload speed test: off'
    case 'failed':
      return `upload speed test failed: ${measurement.detail}`
    case 'measured':
      return `upload speed: ${measurement.mbps.toFixed(1)} Mbit/s`
  }
}
