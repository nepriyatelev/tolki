import { describe, expect, it } from 'vitest'
import { AttemptLimiter, normalizeAddress } from './attempt-limiter'

function setup() {
  let now = 0
  const limiter = new AttemptLimiter(5, 60_000, () => now)
  return {
    limiter,
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe('AttemptLimiter', () => {
  it('allows 5 failures a minute and blocks the address after that', () => {
    const { limiter } = setup()

    for (let i = 0; i < 4; i++) limiter.recordFailure('1.2.3.4')
    expect(limiter.isBlocked('1.2.3.4')).toBe(false)
    limiter.recordFailure('1.2.3.4')

    expect(limiter.isBlocked('1.2.3.4')).toBe(true)
  })

  it('unblocks once the oldest failure is a minute old', () => {
    const { limiter, advance } = setup()
    limiter.recordFailure('1.2.3.4')
    advance(30_000)
    for (let i = 0; i < 4; i++) limiter.recordFailure('1.2.3.4')

    advance(29_999)
    expect(limiter.isBlocked('1.2.3.4')).toBe(true)
    advance(2)
    expect(limiter.isBlocked('1.2.3.4')).toBe(false)
  })

  it('counts each address separately', () => {
    const { limiter } = setup()
    for (let i = 0; i < 5; i++) limiter.recordFailure('1.2.3.4')

    expect(limiter.isBlocked('5.6.7.8')).toBe(false)
  })
})

describe('normalizeAddress', () => {
  it('treats IPv4-mapped IPv6 as IPv4', () => {
    expect(normalizeAddress('::ffff:127.0.0.1')).toBe('127.0.0.1')
    expect(normalizeAddress('2a02:6b8::1')).toBe('2a02:6b8::1')
    expect(normalizeAddress(undefined)).toBe('unknown')
  })
})
