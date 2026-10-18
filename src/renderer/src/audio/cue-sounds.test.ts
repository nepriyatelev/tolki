import { describe, expect, it, vi } from 'vitest'
import { CUE_NOTES, cueLimiter } from './cue-sounds'

describe('call cues (#43)', () => {
  it('go up for coming and down for leaving', () => {
    const [joinFirst = 0, joinSecond = 0] = CUE_NOTES.join
    const [leaveFirst = 0, leaveSecond = 0] = CUE_NOTES.leave
    expect(joinSecond).toBeGreaterThan(joinFirst)
    expect(leaveSecond).toBeLessThan(leaveFirst)
  })

  it('do not pile up when several come at once', () => {
    let now = 0
    const play = vi.fn()
    const cue = cueLimiter(play, 400, () => now)
    cue('join')
    now = 100
    cue('join')
    now = 450
    cue('leave')
    expect(play.mock.calls).toEqual([['join'], ['leave']])
  })
})
