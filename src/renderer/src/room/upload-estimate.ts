import { estimateCapacity, type UploadMeasurement } from '@shared/upload-capacity'

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
  const upload = `Отдача ${formatMbps(measurement.mbps)} Мбит/с`

  if (participants < 2) return `${upload} — этого мало даже для голоса`
  const who = `хватит на ${people(participants)}`
  switch (screen) {
    case '1080p':
      return `${upload} — ${who} и экран в 1080p`
    case '720p':
      return `${upload} — ${who} и экран в 720p`
    case '360p':
      return `${upload} — ${who}, экран только в низком качестве`
    case null:
      return `${upload} — ${who}, на демонстрацию экрана не хватит`
  }
}
