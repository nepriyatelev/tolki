import { uiohookKeyName, type PushToTalkMode } from '@shared/push-to-talk'

/** The part of uiohook-napi's `uIOhook` push-to-talk needs (tests pass a fake). */
export interface KeyHook {
  start(): void
  stop(): void
  on(event: 'keydown' | 'keyup', listener: (event: { keycode: number }) => void): unknown
  removeAllListeners(event?: string): unknown
}

export interface PushToTalkOptions {
  /** Loads the native hook; null when it cannot be loaded on this system. */
  loadHook: () => { hook: KeyHook; keycodes: Record<string, number> } | null
  /** False on Wayland and in e2e: the key then works only while the window has focus. */
  globalAllowed: boolean
  /** macOS «Универсальный доступ»; `ask` shows the system's own request. True elsewhere. */
  trusted: (ask: boolean) => boolean
  /** The key went down or up somewhere in the system. */
  onKey: (pressed: boolean) => void
}

/**
 * The global push-to-talk key (PLAN #39): uiohook sees it over games and other apps without
 * taking it from them. The hook runs only while push-to-talk is on and the user is in a call.
 */
export class PushToTalk {
  #hook: KeyHook | null = null
  #pressed = false

  constructor(private readonly options: PushToTalkOptions) {}

  configure(request: { active: boolean; key: string; askPermission: boolean }): PushToTalkMode {
    this.#stop()
    if (!request.active) return 'off'
    if (!this.options.globalAllowed) return 'focus'
    if (!this.options.trusted(request.askPermission)) return 'needs-permission'
    const loaded = this.options.loadHook()
    const name = uiohookKeyName(request.key)
    const keycode = loaded && name !== null ? loaded.keycodes[name] : undefined
    if (!loaded || keycode === undefined) return 'focus'
    const { hook } = loaded
    // Held keys repeat keydown; only the changes matter.
    const set = (pressed: boolean): void => {
      if (pressed === this.#pressed) return
      this.#pressed = pressed
      this.options.onKey(pressed)
    }
    hook.on('keydown', (event) => {
      if (event.keycode === keycode) set(true)
    })
    hook.on('keyup', (event) => {
      if (event.keycode === keycode) set(false)
    })
    try {
      hook.start()
    } catch {
      hook.removeAllListeners()
      return 'focus'
    }
    this.#hook = hook
    return 'global'
  }

  #stop(): void {
    if (this.#pressed) {
      this.#pressed = false
      this.options.onKey(false)
    }
    if (!this.#hook) return
    this.#hook.removeAllListeners('keydown')
    this.#hook.removeAllListeners('keyup')
    this.#hook.stop()
    this.#hook = null
  }

  close(): void {
    this.#stop()
  }
}
