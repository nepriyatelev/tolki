import { describe, expect, it } from 'vitest'
import { formatCallTime } from './call-timer'

describe('formatCallTime (#80)', () => {
  it('shows minutes and seconds within the first hour', () => {
    expect(formatCallTime(0)).toBe('00:00')
    expect(formatCallTime(7_999)).toBe('00:07')
    expect(formatCallTime(4 * 60_000 + 7_000)).toBe('04:07')
    expect(formatCallTime(3_599_999)).toBe('59:59')
  })

  it('adds hours after an hour', () => {
    expect(formatCallTime(3_600_000)).toBe('1:00:00')
    expect(formatCallTime(3_600_000 + 2 * 60_000 + 9_000)).toBe('1:02:09')
    expect(formatCallTime(12 * 3_600_000)).toBe('12:00:00')
  })

  it('never goes negative (a clock moved back)', () => {
    expect(formatCallTime(-5_000)).toBe('00:00')
  })
})
