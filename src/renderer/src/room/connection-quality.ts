import type { ConnectionSample } from './call'

export type ConnectionLevel = 'good' | 'fair' | 'poor'

export interface ConnectionQuality {
  rttMs: number | null
  /** Percent of packets lost since the previous sample. */
  lossPercent: number
  protocol: 'udp' | 'tcp' | null
  level: ConnectionLevel
}

/** Voice stays natural under these; above the second pair it gets hard to talk (PLAN §6). */
const GOOD = { rttMs: 150, lossPercent: 2 }
const FAIR = { rttMs: 300, lossPercent: 5 }

/** Round trip, loss over the last interval and how good that is for a call. */
export function connectionQuality(
  previous: ConnectionSample | null,
  current: ConnectionSample,
): ConnectionQuality {
  const received = current.packetsReceived - (previous?.packetsReceived ?? 0)
  const lost = current.packetsLost - (previous?.packetsLost ?? 0)
  // Silence sends nothing (DTX): no packets, no loss.
  const lossPercent =
    previous && received + lost > 0 ? Math.max(0, (lost / (received + lost)) * 100) : 0
  const rtt = current.rttMs ?? 0
  const level: ConnectionLevel =
    rtt < GOOD.rttMs && lossPercent < GOOD.lossPercent
      ? 'good'
      : rtt < FAIR.rttMs && lossPercent < FAIR.lossPercent
        ? 'fair'
        : 'poor'
  return { rttMs: current.rttMs, lossPercent, protocol: current.protocol, level }
}

const LEVEL_TEXT: Record<ConnectionLevel, string> = {
  good: 'Связь хорошая',
  fair: 'Связь средняя',
  poor: 'Связь плохая',
}

const PERCENT = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

/** «24 мс · через организатора (UDP)» — the plan's wording (#32, #88). */
export function connectionShortText(quality: ConnectionQuality): string {
  const rtt = quality.rttMs !== null ? `${quality.rttMs} мс · ` : ''
  const via = quality.protocol ? ` (${quality.protocol.toUpperCase()})` : ''
  return `${rtt}через организатора${via}`
}

/** The full story for the tooltip and screen readers. */
export function connectionLongText(quality: ConnectionQuality): string {
  const parts = [LEVEL_TEXT[quality.level]]
  if (quality.rttMs !== null) parts.push(`задержка ${quality.rttMs} мс`)
  parts.push(`потери ${PERCENT.format(quality.lossPercent)} %`)
  parts.push(`через организатора${quality.protocol ? ` по ${quality.protocol.toUpperCase()}` : ''}`)
  return parts.join(', ')
}
