import type { ScreenSample } from './call'

const MBPS = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** «1080p · 30 к/с · 2,8 Мбит/с» from two samples a moment apart (PLAN #30). */
export function screenStatsText(previous: ScreenSample | null, current: ScreenSample): string {
  const parts = [`${current.height}p`, `${current.fps} к/с`]
  if (previous && current.timestamp > previous.timestamp && current.bytes >= previous.bytes) {
    const seconds = (current.timestamp - previous.timestamp) / 1000
    const mbps = ((current.bytes - previous.bytes) * 8) / seconds / 1_000_000
    parts.push(`${MBPS.format(mbps)} Мбит/с`)
  }
  return parts.join(' · ')
}
