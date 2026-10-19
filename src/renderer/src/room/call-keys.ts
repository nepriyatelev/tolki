/** Keys of the call window (#110): with a modifier, as in Discord and Teams. */
export type CallKey = 'mic' | 'sound' | 'shortcuts'

/** macOS uses ⌘ where the others use Ctrl. */
export function isMac(platform: string = navigator.platform): boolean {
  return platform.toUpperCase().startsWith('MAC')
}

/**
 * Ctrl+Shift+M — microphone, Ctrl+Shift+D — sound, Ctrl+/ — the list of keys (⌘ on macOS).
 * By event.code, so the same physical keys work on the Russian layout. A single letter is too
 * easy to press by accident, and none of the apps people know does that.
 */
export function callKeyOf(event: KeyboardEvent, mac: boolean): CallKey | null {
  const mod = mac ? event.metaKey : event.ctrlKey
  const otherMod = mac ? event.ctrlKey : event.metaKey
  if (!mod || otherMod || event.altKey || event.repeat) return null
  if (event.code === 'Slash' && !event.shiftKey) return 'shortcuts'
  if (!event.shiftKey) return null
  if (event.code === 'KeyM') return 'mic'
  if (event.code === 'KeyD') return 'sound'
  return null
}

/** «Ctrl+Shift+M» or «⌘⇧M», as each system writes its keys. */
export function callKeyLabel(key: CallKey, mac: boolean): string {
  const letter = key === 'mic' ? 'M' : key === 'sound' ? 'D' : '/'
  if (key === 'shortcuts') return mac ? '⌘/' : 'Ctrl+/'
  return mac ? `⌘⇧${letter}` : `Ctrl+Shift+${letter}`
}
