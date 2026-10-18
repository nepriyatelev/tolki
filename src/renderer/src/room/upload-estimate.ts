import {
  estimateCapacity,
  type ScreenQuality,
  type UploadMeasurement,
} from '@shared/upload-capacity'

const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })
const plural = new Intl.PluralRules('ru-RU')

export function formatMbps(mbps: number): string {
  return number.format(mbps >= 10 ? Math.round(mbps) : Math.round(mbps * 10) / 10)
}

/** "на 2 человека", "на 5 человек" (accusative after "хватит на"). */
function people(count: number): string {
  const form = plural.select(count)
  return `${count} ${form === 'one' || form === 'few' ? 'человека' : 'человек'}`
}

/**
 * Line for the "create room" screen (PLAN #10). Null means "show nothing": the test is turned
 * off or failed, and the screen must work the same without it.
 */
export function describeUpload(measurement: UploadMeasurement): string | null {
  if (measurement.status !== 'measured') return null

  const { participants, screen } = estimateCapacity(measurement.mbps)
  return `Отдача ${formatMbps(measurement.mbps)} Мбит/с — ${carries(participants, screen)}`
}

/** «хватит на 15 человек и экран в 720p» and the like. */
function carries(participants: number, screen: ScreenQuality | null): string {
  if (participants < 2) return 'этого мало даже для голоса'
  const who = `хватит на ${people(participants)}`
  switch (screen) {
    case '1080p':
      return `${who} и экран в 1080p`
    case '720p':
      return `${who} и экран в 720p`
    case '360p':
      return `${who}, экран только в низком качестве`
    case null:
      return `${who}, на демонстрацию экрана не хватит`
  }
}

/** The organizer's upload as the host reports it in the call (#87). */
export interface HostStats {
  uploadMbps: number
  participants: number
  screen: ScreenQuality | null
  /** From the speed test; otherwise only the call's statistics, a lower bound. */
  measured: boolean
}

/** «Отдача организатора 39 Мбит/с» for the call header; «от 12» when it is a lower bound. */
export function hostUploadText(stats: HostStats): string {
  return `Отдача организатора ${stats.measured ? '' : 'от '}${formatMbps(stats.uploadMbps)} Мбит/с`
}

/** The hint under it: «Хватит на 15 человек и экран в 720p». */
export function hostUploadHint(stats: HostStats): string {
  const text = carries(stats.participants, stats.screen)
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * A warning when the organizer's measured upload is short of the call as it is now; null when
 * it is enough, or only a lower bound is known (no false alarms).
 */
export function hostUploadWarning(
  stats: HostStats,
  inCall: number,
  screenShown: boolean,
): string | null {
  if (!stats.measured) return null
  if (inCall > stats.participants) {
    return 'Организатору не хватает скорости отдачи на всех — звук может прерываться'
  }
  if (screenShown && stats.screen === null) {
    return 'Организатору не хватает скорости отдачи на показ экрана — он может тормозить'
  }
  return null
}
