import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { PushToTalk, type KeyHook } from './push-to-talk'

class FakeHook extends EventEmitter implements KeyHook {
  start = vi.fn()
  stop = vi.fn()
}

const KEYCODES = { Backquote: 41, V: 47 }

function setup(options: { globalAllowed?: boolean; trusted?: boolean; load?: boolean } = {}) {
  const hook = new FakeHook()
  const onKey = vi.fn()
  const trusted = vi.fn(() => options.trusted ?? true)
  const ptt = new PushToTalk({
    loadHook: () => (options.load === false ? null : { hook, keycodes: KEYCODES }),
    globalAllowed: options.globalAllowed ?? true,
    trusted,
    onKey,
  })
  return { ptt, hook, onKey, trusted }
}

describe('PushToTalk (#39)', () => {
  it('hooks the key globally and reports presses once, not every repeat', () => {
    const { ptt, hook, onKey } = setup()
    expect(ptt.configure({ active: true, key: 'KeyV', askPermission: false })).toBe('global')
    expect(hook.start).toHaveBeenCalledOnce()

    hook.emit('keydown', { keycode: 47 })
    hook.emit('keydown', { keycode: 47 })
    hook.emit('keydown', { keycode: 41 })
    hook.emit('keyup', { keycode: 47 })
    expect(onKey.mock.calls).toEqual([[true], [false]])
  })

  it('stops the hook when push-to-talk is off or the call ends, releasing a held key', () => {
    const { ptt, hook, onKey } = setup()
    ptt.configure({ active: true, key: 'KeyV', askPermission: false })
    hook.emit('keydown', { keycode: 47 })

    expect(ptt.configure({ active: false, key: 'KeyV', askPermission: false })).toBe('off')
    expect(hook.stop).toHaveBeenCalledOnce()
    expect(onKey.mock.calls.at(-1)).toEqual([false])
    hook.emit('keydown', { keycode: 47 })
    expect(onKey).toHaveBeenCalledTimes(2)
  })

  it('switches to another key without leaving the old one hooked', () => {
    const { ptt, hook, onKey } = setup()
    ptt.configure({ active: true, key: 'KeyV', askPermission: false })
    ptt.configure({ active: true, key: 'Backquote', askPermission: false })
    hook.emit('keydown', { keycode: 47 })
    hook.emit('keydown', { keycode: 41 })
    expect(onKey.mock.calls).toEqual([[true]])
  })

  it('works only in focus on Wayland and in e2e, without touching the hook', () => {
    const { ptt, hook } = setup({ globalAllowed: false })
    expect(ptt.configure({ active: true, key: 'KeyV', askPermission: true })).toBe('focus')
    expect(hook.start).not.toHaveBeenCalled()
  })

  it('asks macOS for «Универсальный доступ» only when told to, and waits for it', () => {
    const { ptt, hook, trusted } = setup({ trusted: false })
    expect(ptt.configure({ active: true, key: 'KeyV', askPermission: true })).toBe(
      'needs-permission',
    )
    expect(trusted).toHaveBeenLastCalledWith(true)
    expect(hook.start).not.toHaveBeenCalled()
  })

  it('falls back to focus when the native hook cannot load or start', () => {
    expect(
      setup({ load: false }).ptt.configure({ active: true, key: 'KeyV', askPermission: false }),
    ).toBe('focus')
    const broken = setup()
    broken.hook.start.mockImplementation(() => {
      throw new Error('no X display')
    })
    expect(broken.ptt.configure({ active: true, key: 'KeyV', askPermission: false })).toBe('focus')
  })
})
