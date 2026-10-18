import type { HotkeyAction, HotkeyStatus } from '@shared/global-hotkeys'

/** The part of Electron's globalShortcut the hotkeys need (tests pass a fake). */
export interface ShortcutRegistry {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

/**
 * The user's global hotkeys for the microphone and the sound (PLAN #40). Registered only while
 * the user is in a call: a registered accelerator is taken from every other app.
 */
export class GlobalHotkeys {
  readonly #registered = new Set<string>()

  constructor(
    private readonly shortcuts: ShortcutRegistry,
    private readonly onPress: (action: HotkeyAction) => void,
  ) {}

  configure(request: {
    active: boolean
    mute: string
    deafen: string
  }): Record<HotkeyAction, HotkeyStatus> {
    this.#unregisterAll()
    const status: Record<HotkeyAction, HotkeyStatus> = { mute: 'none', deafen: 'none' }
    if (!request.active) return status
    for (const action of ['mute', 'deafen'] as const) {
      const accelerator = request[action]
      if (!accelerator) continue
      // The same combination for both: the first one gets it.
      if (this.#registered.has(accelerator)) {
        status[action] = 'taken'
        continue
      }
      const ok = this.shortcuts.register(accelerator, () => {
        this.onPress(action)
      })
      status[action] = ok ? 'ok' : 'taken'
      if (ok) this.#registered.add(accelerator)
    }
    return status
  }

  #unregisterAll(): void {
    for (const accelerator of this.#registered) this.shortcuts.unregister(accelerator)
    this.#registered.clear()
  }

  close(): void {
    this.#unregisterAll()
  }
}
