import { describe, expect, it } from 'vitest'
import { describeUpload, formatMbps } from './upload-estimate'

const measured = (mbps: number) => ({ status: 'measured' as const, mbps, measuredAt: 0 })

describe('describeUpload', () => {
  it('matches the mockup for a fast link', () => {
    expect(describeUpload(measured(92.4))).toBe(
      'Отдача 92 Мбит/с — хватит на 15 человек и экран в 1080p',
    )
  })

  it.each([
    [40, 'Отдача 40 Мбит/с — хватит на 15 человек и экран в 720p'],
    [20, 'Отдача 20 Мбит/с — хватит на 15 человек, экран только в низком качестве'],
    [1, 'Отдача 1 Мбит/с — хватит на 6 человек, на демонстрацию экрана не хватит'],
    [0.42, 'Отдача 0,4 Мбит/с — хватит на 3 человека, на демонстрацию экрана не хватит'],
    [0.1, 'Отдача 0,1 Мбит/с — этого мало даже для голоса'],
  ])('%s Mbit/s → %s', (mbps, text) => {
    expect(describeUpload(measured(mbps))).toBe(text)
  })

  it('shows nothing when the test is off or failed', () => {
    expect(describeUpload({ status: 'disabled' })).toBeNull()
    expect(describeUpload({ status: 'failed', detail: 'offline' })).toBeNull()
  })
})

describe('formatMbps', () => {
  it('rounds to whole numbers from 10 and to tenths below, with a Russian comma', () => {
    expect(formatMbps(92.6)).toBe('93')
    expect(formatMbps(9.94)).toBe('9,9')
    expect(formatMbps(2)).toBe('2')
  })
})
