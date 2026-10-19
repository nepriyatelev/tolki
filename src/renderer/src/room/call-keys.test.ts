import { describe, expect, it } from 'vitest'
import { callKeyLabel, callKeyOf, isMac } from './call-keys'

const key = (code: string, mods: Partial<KeyboardEvent> = {}) =>
  ({
    code,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    ...mods,
  }) as KeyboardEvent

describe('call keys (#110)', () => {
  it('Ctrl+Shift+M / D and Ctrl+/ elsewhere, ⌘ on macOS; a single letter does nothing', () => {
    expect(callKeyOf(key('KeyM', { ctrlKey: true, shiftKey: true }), false)).toBe('mic')
    expect(callKeyOf(key('KeyD', { ctrlKey: true, shiftKey: true }), false)).toBe('sound')
    expect(callKeyOf(key('Slash', { ctrlKey: true }), false)).toBe('shortcuts')
    expect(callKeyOf(key('KeyM', { metaKey: true, shiftKey: true }), true)).toBe('mic')
    expect(callKeyOf(key('KeyM'), false)).toBeNull()
    expect(callKeyOf(key('KeyM', { shiftKey: true }), false)).toBeNull()
    // ⌘ is not Ctrl on Windows and Linux, and the other way round on macOS.
    expect(callKeyOf(key('KeyM', { metaKey: true, shiftKey: true }), false)).toBeNull()
    expect(callKeyOf(key('KeyM', { ctrlKey: true, shiftKey: true }), true)).toBeNull()
    expect(
      callKeyOf(key('KeyM', { ctrlKey: true, shiftKey: true, altKey: true }), false),
    ).toBeNull()
    expect(
      callKeyOf(key('KeyM', { ctrlKey: true, shiftKey: true, repeat: true }), false),
    ).toBeNull()
  })

  it('writes the keys the way each system does', () => {
    expect(callKeyLabel('mic', false)).toBe('Ctrl+Shift+M')
    expect(callKeyLabel('sound', true)).toBe('⌘⇧D')
    expect(callKeyLabel('shortcuts', false)).toBe('Ctrl+/')
    expect(callKeyLabel('shortcuts', true)).toBe('⌘/')
    expect(isMac('MacIntel')).toBe(true)
    expect(isMac('Win32')).toBe(false)
  })
})
