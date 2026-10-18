import { parseInvite, type InviteParseResult } from '@shared/invite'

/** Finds a tolki:// link among command-line arguments (Windows and Linux deep links). */
export function findInviteLink(argv: readonly string[]): string | null {
  return argv.find((arg) => arg.toLowerCase().startsWith('tolki:')) ?? null
}

/**
 * Collects invite links from the OS (startup arguments, second instance, macOS open-url) and
 * hands them to the renderer. Links that arrive before the renderer is ready wait; only the
 * latest one is kept, as that is the one the user just clicked.
 *
 * Links are untrusted input: they are parsed strictly here and never logged (they may contain
 * the room password).
 */
export class InviteLinks {
  #pending: InviteParseResult | null = null
  #rendererReady = false
  readonly #deliver: (result: InviteParseResult) => void

  constructor(deliver: (result: InviteParseResult) => void) {
    this.#deliver = deliver
  }

  receive(link: string): void {
    const result = parseInvite(link)
    if (this.#rendererReady) this.#deliver(result)
    else this.#pending = result
  }

  /** Called by the renderer once it can show screens; returns a link that arrived earlier. */
  takePending(): InviteParseResult | null {
    this.#rendererReady = true
    const pending = this.#pending
    this.#pending = null
    return pending
  }

  /** The renderer is (re)loading: hold links until it asks again. */
  rendererGone(): void {
    this.#rendererReady = false
  }
}
