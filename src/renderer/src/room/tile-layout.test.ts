import { describe, expect, it } from 'vitest'
import { tileLayout } from './tile-layout'

describe('tileLayout (#110)', () => {
  it('one person fills the space, as big as the shape allows', () => {
    expect(tileLayout(1, 1200, 600, 14)).toEqual({ columns: 1, width: 960 })
  })

  it('picks the column count with the biggest tiles', () => {
    expect(tileLayout(2, 1200, 600, 14).columns).toBe(2)
    expect(tileLayout(4, 1200, 700, 14).columns).toBe(2)
    expect(tileLayout(6, 1200, 600, 14).columns).toBe(3)
    // A tall, narrow window stacks them.
    expect(tileLayout(3, 400, 1000, 14).columns).toBe(1)
  })

  it('fits fifteen people without overflowing', () => {
    const { columns, width } = tileLayout(15, 1200, 600, 14)
    const rows = Math.ceil(15 / columns)
    expect(columns * width + (columns - 1) * 14).toBeLessThanOrEqual(1200)
    expect(rows * (width / (16 / 10)) + (rows - 1) * 14).toBeLessThanOrEqual(600)
  })

  it('gives nothing for no space or nobody', () => {
    expect(tileLayout(0, 1200, 600, 14).width).toBe(0)
    expect(tileLayout(3, 0, 600, 14).width).toBe(0)
  })
})
