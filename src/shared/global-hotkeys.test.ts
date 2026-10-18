import { describe, expect, it } from 'vitest'
import { acceleratorFromPress, acceleratorLabel, isHotkeyAccelerator } from './global-hotkeys'

const press = (
  code: string,
  mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {},
) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
})

describe('global hotkeys (#40)', () => {
  it('turns a press with a modifier into an Electron accelerator', () => {
    expect(acceleratorFromPress(press('KeyM', { ctrlKey: true, shiftKey: true }))).toBe(
      'Control+Shift+M',
    )
    expect(acceleratorFromPress(press('KeyD', { metaKey: true, shiftKey: true }))).toBe(
      'Command+Shift+D',
    )
    expect(acceleratorFromPress(press('Digit1', { altKey: true }))).toBe('Alt+1')
    expect(acceleratorFromPress(press('Numpad4', { ctrlKey: true }))).toBe('Control+num4')
    expect(acceleratorFromPress(press('Backquote', { ctrlKey: true }))).toBe('Control+`')
    expect(acceleratorFromPress(press('F9'))).toBe('F9')
  })

  it('refuses keys that would fire while typing, and keys it cannot hold', () => {
    expect(acceleratorFromPress(press('KeyM'))).toBeNull()
    expect(acceleratorFromPress(press('KeyM', { shiftKey: true }))).toBeNull()
    expect(acceleratorFromPress(press('ControlLeft', { ctrlKey: true }))).toBeNull()
    expect(acceleratorFromPress(press('MediaPlayPause', { ctrlKey: true }))).toBeNull()
  })

  it('accepts only what it makes', () => {
    expect(isHotkeyAccelerator('Control+Shift+M')).toBe(true)
    expect(isHotkeyAccelerator('F9')).toBe(true)
    expect(isHotkeyAccelerator('Shift+M')).toBe(false)
    expect(isHotkeyAccelerator('M')).toBe(false)
    expect(isHotkeyAccelerator('Control+Control+M')).toBe(false)
    expect(isHotkeyAccelerator('Super+M')).toBe(false)
    expect(isHotkeyAccelerator('Control+MediaPlay')).toBe(false)
  })

  it('labels accelerators the short way', () => {
    expect(acceleratorLabel('Control+Shift+M')).toBe('Ctrl+Shift+M')
    expect(acceleratorLabel('Command+Shift+D')).toBe('Cmd+Shift+D')
    expect(acceleratorLabel('Control+num4')).toBe('Ctrl+Num 4')
  })
})
