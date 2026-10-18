// Push-to-talk (PLAN #39): the key is stored as KeyboardEvent.code — the physical key, the same
// on the Russian and English layouts — and mapped to uiohook's key names for the global hook.

/** How the key reaches the app now. */
export type PushToTalkMode =
  /** Not in use. */
  | 'off'
  /** Everywhere, over games too (uiohook). */
  | 'global'
  /** Only while the Tolki window has focus: Wayland, or the global hook is unavailable. */
  | 'focus'
  /** macOS: «Универсальный доступ» is not allowed yet; until then, like `focus`. */
  | 'needs-permission'

export const DEFAULT_PUSH_TO_TALK_KEY = 'Backquote'

const SAME_NAME = new Set([
  'Backspace',
  'Tab',
  'Enter',
  'CapsLock',
  'Space',
  'PageUp',
  'PageDown',
  'End',
  'Home',
  'ArrowLeft',
  'ArrowUp',
  'ArrowRight',
  'ArrowDown',
  'Insert',
  'Delete',
  'Semicolon',
  'Equal',
  'Comma',
  'Minus',
  'Period',
  'Slash',
  'Backquote',
  'BracketLeft',
  'Backslash',
  'BracketRight',
  'Quote',
  'NumLock',
  'ScrollLock',
  'PrintScreen',
  'NumpadMultiply',
  'NumpadAdd',
  'NumpadSubtract',
  'NumpadDecimal',
  'NumpadDivide',
  'NumpadEnter',
  'AltRight',
  'ShiftRight',
  'MetaRight',
])

const RENAMED: Record<string, string> = {
  ControlLeft: 'Ctrl',
  ControlRight: 'CtrlRight',
  AltLeft: 'Alt',
  ShiftLeft: 'Shift',
  MetaLeft: 'Meta',
}

/** uiohook's name of the key (a key of `UiohookKey`), or null if it has none. */
export function uiohookKeyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code
  if (/^Numpad\d$/.test(code)) return code
  if (code in RENAMED) return RENAMED[code] ?? null
  return SAME_NAME.has(code) ? code : null
}

/** A key that can hold the microphone open: one uiohook knows, and not Escape (it cancels). */
export function isPushToTalkKey(code: string): boolean {
  return code !== 'Escape' && uiohookKeyName(code) !== null
}

const LABELS: Record<string, string> = {
  Backquote: 'Ё (`)',
  Space: 'Пробел',
  CapsLock: 'Caps Lock',
  Tab: 'Tab',
  Enter: 'Enter',
  Backspace: 'Backspace',
  ControlLeft: 'Ctrl',
  ControlRight: 'правый Ctrl',
  AltLeft: 'Alt',
  AltRight: 'правый Alt',
  ShiftLeft: 'Shift',
  ShiftRight: 'правый Shift',
  MetaLeft: 'Cmd / Win',
  MetaRight: 'правый Cmd / Win',
  ArrowLeft: '←',
  ArrowUp: '↑',
  ArrowRight: '→',
  ArrowDown: '↓',
}

/** «Ё (`)», «Пробел», «V», «F5», «Num 1». */
export function pushToTalkKeyLabel(code: string): string {
  if (code in LABELS) return LABELS[code] ?? code
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`
  return code
}
