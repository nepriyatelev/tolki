// Global hotkeys for the microphone and the sound (PLAN #40), set by the user; none by default.
// Stored as Electron accelerators («Control+Shift+M») — what globalShortcut registers.

export type HotkeyAction = 'mute' | 'deafen'

/** How a hotkey is held now: registered, taken by another app, or not set. */
export type HotkeyStatus = 'ok' | 'taken' | 'none'

const MODIFIERS = ['Command', 'Control', 'Alt', 'Shift'] as const

const NAMED: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
}

/** The key part of an accelerator for KeyboardEvent.code, or null for keys it cannot hold. */
function keyOf(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code
  if (/^Numpad\d$/.test(code)) return `num${code.slice(6)}`
  return NAMED[code] ?? null
}

export interface KeyPress {
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

/**
 * The accelerator for a key press, or null if it cannot be a global hotkey: a plain letter
 * would fire while typing in other apps, so Ctrl, Alt or Cmd is needed (F-keys may go alone).
 */
export function acceleratorFromPress(press: KeyPress): string | null {
  const key = keyOf(press.code)
  if (key === null) return null
  const parts = [
    ...(press.metaKey ? ['Command'] : []),
    ...(press.ctrlKey ? ['Control'] : []),
    ...(press.altKey ? ['Alt'] : []),
    ...(press.shiftKey ? ['Shift'] : []),
  ]
  const strong = press.metaKey || press.ctrlKey || press.altKey
  if (!strong && !/^F\d+$/.test(key)) return null
  return [...parts, key].join('+')
}

/** Only accelerators made by acceleratorFromPress (checked again in main). */
export function isHotkeyAccelerator(accelerator: string): boolean {
  if (accelerator.length > 48) return false
  const parts = accelerator.split('+')
  const key = parts.pop() ?? ''
  if (!parts.every((p) => (MODIFIERS as readonly string[]).includes(p))) return false
  if (new Set(parts).size !== parts.length) return false
  const known =
    /^[A-Z0-9]$/.test(key) ||
    /^F([1-9]|1\d|2[0-4])$/.test(key) ||
    /^num\d$/.test(key) ||
    Object.values(NAMED).includes(key)
  const strong = parts.some((p) => p !== 'Shift')
  return known && (strong || /^F\d+$/.test(key))
}

/** «Ctrl+Shift+M», «Cmd+Shift+M», «Alt+F5». */
export function acceleratorLabel(accelerator: string): string {
  return accelerator
    .split('+')
    .map((part) =>
      part === 'Command'
        ? 'Cmd'
        : part === 'Control'
          ? 'Ctrl'
          : part.startsWith('num')
            ? `Num ${part.slice(3)}`
            : part,
    )
    .join('+')
}
