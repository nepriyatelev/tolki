import { describe, expect, it } from 'vitest'
import { isPushToTalkKey, pushToTalkKeyLabel, uiohookKeyName } from './push-to-talk'

describe('push-to-talk keys (#39)', () => {
  it('maps physical keys to uiohook names', () => {
    expect(uiohookKeyName('KeyV')).toBe('V')
    expect(uiohookKeyName('Digit4')).toBe('4')
    expect(uiohookKeyName('F13')).toBe('F13')
    expect(uiohookKeyName('Numpad0')).toBe('Numpad0')
    expect(uiohookKeyName('ControlLeft')).toBe('Ctrl')
    expect(uiohookKeyName('ControlRight')).toBe('CtrlRight')
    expect(uiohookKeyName('AltLeft')).toBe('Alt')
    expect(uiohookKeyName('Backquote')).toBe('Backquote')
    expect(uiohookKeyName('CapsLock')).toBe('CapsLock')
  })

  it('knows which keys cannot be used', () => {
    expect(uiohookKeyName('MediaPlayPause')).toBeNull()
    expect(isPushToTalkKey('Escape')).toBe(false)
    expect(isPushToTalkKey('IntlBackslash')).toBe(false)
    expect(isPushToTalkKey('Space')).toBe(true)
  })

  it('labels keys the way people know them', () => {
    expect(pushToTalkKeyLabel('Backquote')).toBe('Ё (`)')
    expect(pushToTalkKeyLabel('Space')).toBe('Пробел')
    expect(pushToTalkKeyLabel('KeyV')).toBe('V')
    expect(pushToTalkKeyLabel('Digit1')).toBe('1')
    expect(pushToTalkKeyLabel('Numpad5')).toBe('Num 5')
    expect(pushToTalkKeyLabel('F5')).toBe('F5')
    expect(pushToTalkKeyLabel('ControlRight')).toBe('правый Ctrl')
  })
})
