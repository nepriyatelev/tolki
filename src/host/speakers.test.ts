import { describe, expect, it } from 'vitest'
import { QUIET_TICKS, SpeakerSelector } from './speakers'

const sorted = (set: ReadonlySet<string>) => [...set].sort()

describe('SpeakerSelector', () => {
  it('forwards the first three voices right away', () => {
    const s = new SpeakerSelector()
    expect([s.add('a'), s.add('b'), s.add('c'), s.add('d')]).toEqual([true, true, true, false])
    expect(sorted(s.forwarded)).toEqual(['a', 'b', 'c'])
  })

  it('gives a new loud voice the slot of the one quiet the longest', () => {
    const s = new SpeakerSelector(3, 0)
    for (const id of ['a', 'b', 'c', 'd', 'e']) s.add(id)
    s.heard(['a'])
    s.heard(['b'])
    s.heard(['c'])

    expect(s.heard(['d'])).toBe(true)
    expect(sorted(s.forwarded)).toEqual(['b', 'c', 'd'])
    expect(s.heard(['e', 'd'])).toBe(true)
    expect(sorted(s.forwarded)).toEqual(['c', 'd', 'e'])
  })

  it('keeps a voice that is still talking, even when others are as loud (no flapping)', () => {
    const s = new SpeakerSelector()
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    for (const id of ids) s.add(id)
    // Everyone talks at the same level; the order of «loudest» changes every report.
    for (let i = 0; i < 30; i++) {
      const order = [...ids.slice(i % 6), ...ids.slice(0, i % 6)]
      expect(s.heard(order)).toBe(false)
    }
    expect(sorted(s.forwarded)).toEqual(['a', 'b', 'c'])
  })

  it('frees the slot of a voice silent for about two seconds, not after a short pause', () => {
    const s = new SpeakerSelector()
    for (const id of ['a', 'b', 'c', 'd']) s.add(id)
    s.heard(['a', 'b', 'c'])
    // c pauses; d starts. Seven reports (~2 s) of c's silence keep its slot…
    for (let i = 0; i < QUIET_TICKS; i++) expect(s.heard(['d', 'a', 'b'])).toBe(false)
    // …the next one frees it.
    expect(s.heard(['d', 'a', 'b'])).toBe(true)
    expect(sorted(s.forwarded)).toEqual(['a', 'b', 'd'])
  })

  it('keeps the slots while the same people talk', () => {
    const s = new SpeakerSelector()
    for (const id of ['a', 'b', 'c', 'd']) s.add(id)
    expect(s.heard(['a', 'b', 'c'])).toBe(false)
    expect(s.heard(['c'])).toBe(false)
    expect(sorted(s.forwarded)).toEqual(['a', 'b', 'c'])
  })

  it('never forwards more than three, however many talk at once', () => {
    const s = new SpeakerSelector()
    const ids = Array.from({ length: 15 }, (_, i) => `p${i}`)
    for (const id of ids) s.add(id)
    for (let i = 0; i < 50; i++) {
      s.heard(
        [ids[(i * 7) % 15], ids[(i * 3 + 1) % 15], ids[(i + 5) % 15]].filter(
          (x) => x !== undefined,
        ),
      )
      expect(s.forwarded.size).toBe(3)
    }
  })

  it('hands a freed slot to whoever was heard last', () => {
    const s = new SpeakerSelector(1, 0)
    for (const id of ['a', 'b', 'c']) s.add(id)
    s.heard(['b'])
    s.heard(['c'])

    expect(s.remove('c')).toBe(true)
    expect(sorted(s.forwarded)).toEqual(['b'])
    expect(s.remove('a')).toBe(false)
    expect(s.remove('zzz')).toBe(false)
  })

  it('ignores voices it does not know', () => {
    const s = new SpeakerSelector()
    s.add('a')
    expect(s.heard(['ghost'])).toBe(false)
    expect(sorted(s.forwarded)).toEqual(['a'])
  })
})
