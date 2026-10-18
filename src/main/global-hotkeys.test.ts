import { describe, expect, it, vi } from 'vitest'
import { GlobalHotkeys, type ShortcutRegistry } from './global-hotkeys'

function fakeShortcuts(taken: string[] = []) {
  const callbacks = new Map<string, () => void>()
  const registry: ShortcutRegistry = {
    register: vi.fn((accelerator: string, callback: () => void) => {
      if (taken.includes(accelerator) || callbacks.has(accelerator)) return false
      callbacks.set(accelerator, callback)
      return true
    }),
    unregister: vi.fn((accelerator: string) => {
      callbacks.delete(accelerator)
    }),
  }
  return { registry, press: (accelerator: string) => callbacks.get(accelerator)?.(), callbacks }
}

describe('GlobalHotkeys (#40)', () => {
  it('registers the set hotkeys in a call and reports presses', () => {
    const shortcuts = fakeShortcuts()
    const onPress = vi.fn()
    const hotkeys = new GlobalHotkeys(shortcuts.registry, onPress)

    expect(
      hotkeys.configure({ active: true, mute: 'Control+Shift+M', deafen: 'Control+Shift+D' }),
    ).toEqual({ mute: 'ok', deafen: 'ok' })
    shortcuts.press('Control+Shift+M')
    shortcuts.press('Control+Shift+D')
    expect(onPress.mock.calls).toEqual([['mute'], ['deafen']])
  })

  it('takes nothing from other apps out of a call or when nothing is set', () => {
    const shortcuts = fakeShortcuts()
    const hotkeys = new GlobalHotkeys(shortcuts.registry, vi.fn())
    expect(hotkeys.configure({ active: true, mute: '', deafen: '' })).toEqual({
      mute: 'none',
      deafen: 'none',
    })
    hotkeys.configure({ active: true, mute: 'Control+Shift+M', deafen: '' })
    expect(hotkeys.configure({ active: false, mute: 'Control+Shift+M', deafen: '' })).toEqual({
      mute: 'none',
      deafen: 'none',
    })
    expect(shortcuts.callbacks.size).toBe(0)
  })

  it('says when another app holds the combination, or both use the same one', () => {
    const hotkeys = new GlobalHotkeys(fakeShortcuts(['Control+Shift+M']).registry, vi.fn())
    expect(
      hotkeys.configure({ active: true, mute: 'Control+Shift+M', deafen: 'Control+Shift+D' }),
    ).toEqual({ mute: 'taken', deafen: 'ok' })
    const same = new GlobalHotkeys(fakeShortcuts().registry, vi.fn())
    expect(same.configure({ active: true, mute: 'F9', deafen: 'F9' })).toEqual({
      mute: 'ok',
      deafen: 'taken',
    })
  })

  it('swaps a hotkey without leaving the old one registered', () => {
    const shortcuts = fakeShortcuts()
    const hotkeys = new GlobalHotkeys(shortcuts.registry, vi.fn())
    hotkeys.configure({ active: true, mute: 'Control+Shift+M', deafen: '' })
    hotkeys.configure({ active: true, mute: 'Alt+M', deafen: '' })
    expect([...shortcuts.callbacks.keys()]).toEqual(['Alt+M'])
  })
})
