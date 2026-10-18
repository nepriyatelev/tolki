import { describe, expect, it, vi } from 'vitest'
import { lineWriter, mergeLogs, savedLogName } from './logging'

describe('mergeLogs (#106)', () => {
  it('puts the lines of every source in time order, tagged with the source', () => {
    const merged = mergeLogs([
      {
        source: 'main',
        text: '[2026-10-18 10:00:00.100] [info]  app start\n[2026-10-18 10:00:02.000] [info]  join\n',
      },
      { source: 'host', text: '[2026-10-18 10:00:01.000] [info]  room open\n' },
    ])
    expect(merged.split('\n')).toEqual([
      '[2026-10-18 10:00:00.100] [main] [info]  app start',
      '[2026-10-18 10:00:01.000] [host] [info]  room open',
      '[2026-10-18 10:00:02.000] [main] [info]  join',
    ])
  })

  it('keeps a stack trace with its line', () => {
    const merged = mergeLogs([
      {
        source: 'renderer',
        text: '[2026-10-18 10:00:00.000] [error] Error: boom\n    at a (x.js:1)\n    at b (y.js:2)\n',
      },
      { source: 'main', text: '[2026-10-18 10:00:00.500] [info]  later\n' },
    ])
    expect(merged).toBe(
      '[2026-10-18 10:00:00.000] [renderer] [error] Error: boom\n    at a (x.js:1)\n    at b (y.js:2)\n' +
        '[2026-10-18 10:00:00.500] [main] [info]  later',
    )
  })
})

describe('savedLogName', () => {
  it('names the file by date and time', () => {
    expect(savedLogName(new Date(2026, 9, 18, 13, 5))).toBe('tolki-logs-2026-10-18-1305.txt')
  })
})

describe('lineWriter', () => {
  it('writes whole lines only, across chunks', () => {
    const write = vi.fn()
    const feed = lineWriter(write)
    feed('first li')
    feed('ne\nsecond\n\nthi')
    feed('rd\n')
    expect(write.mock.calls.map((c) => c[0] as string)).toEqual(['first line', 'second', 'third'])
  })
})
