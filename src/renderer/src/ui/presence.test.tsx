import { createRoot, createSignal } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPresence, EXIT_MS } from './presence'

describe('createPresence (#149)', () => {
  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(window, 'matchMedia')
  })

  function setup(initial: boolean) {
    const [open, setOpen] = createSignal(initial)
    let presence!: ReturnType<typeof createPresence>
    const dispose = createRoot((d) => {
      presence = createPresence(open)
      return d
    })
    return { setOpen, presence, dispose }
  }

  it('keeps the element while it leaves, then removes it', () => {
    vi.useFakeTimers()
    Object.assign(window, { matchMedia: () => ({ matches: false }) })
    const { setOpen, presence, dispose } = setup(true)
    expect([presence.mounted(), presence.closing()]).toEqual([true, false])

    setOpen(false)
    expect([presence.mounted(), presence.closing()]).toEqual([true, true])
    vi.advanceTimersByTime(EXIT_MS)
    expect([presence.mounted(), presence.closing()]).toEqual([false, false])
    dispose()
  })

  it('coming back during the exit cancels it', () => {
    vi.useFakeTimers()
    Object.assign(window, { matchMedia: () => ({ matches: false }) })
    const { setOpen, presence, dispose } = setup(true)
    setOpen(false)
    vi.advanceTimersByTime(EXIT_MS / 2)
    setOpen(true)
    vi.advanceTimersByTime(EXIT_MS)
    expect([presence.mounted(), presence.closing()]).toEqual([true, false])
    dispose()
  })

  it('without animations (no matchMedia) it goes at once', () => {
    const { setOpen, presence, dispose } = setup(false)
    expect(presence.mounted()).toBe(false)
    setOpen(true)
    expect(presence.mounted()).toBe(true)
    setOpen(false)
    expect(presence.mounted()).toBe(false)
    dispose()
  })
})
