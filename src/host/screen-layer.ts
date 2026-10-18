import type { ScreenLayer } from '@shared/signaling'

/** Below this estimate of the viewer's downlink, ≈1080p does not fit; ≈360p needs 0.5 Mbit/s. */
export const HIGH_LAYER_MIN_BPS = 1_000_000
/** The estimate has to stay low this long: it dips for a moment now and then. */
export const DOWNGRADE_AFTER_MS = 5000
/** After going down, try ≈1080p again this much later: the network may have recovered. */
export const RETRY_HIGH_AFTER_MS = 30_000

/**
 * Which of the screen's streams one viewer gets (#34): the one they asked for by the size they
 * show it at, but ≈360p while their network cannot carry ≈1080p. The sharer sends both, so
 * the choice is the host's, per viewer — what simulcast layers did before.
 */
export class ScreenLayerChoice {
  #preferred: ScreenLayer = 1
  #networkAllowsHigh = true
  #lowSince: number | null = null
  #retry: ReturnType<typeof setTimeout> | undefined

  constructor(
    /** The chosen layer may have changed. */
    private readonly onChange: () => void,
    private readonly now: () => number = Date.now,
  ) {}

  /** The layer to send, given which streams the sharer has. Null: no screen. */
  pick(available: ReadonlySet<ScreenLayer>): ScreenLayer | null {
    const wanted: ScreenLayer = this.#networkAllowsHigh ? this.#preferred : 0
    if (available.has(wanted)) return wanted
    if (available.has(1)) return 1
    return available.has(0) ? 0 : null
  }

  prefer(layer: ScreenLayer): void {
    if (this.#preferred === layer) return
    this.#preferred = layer
    this.onChange()
  }

  /** The viewer's downlink estimate (bit/s) while they receive ≈1080p. */
  estimate(availableBps: number): void {
    if (!this.#networkAllowsHigh) return
    if (availableBps >= HIGH_LAYER_MIN_BPS) {
      this.#lowSince = null
      return
    }
    const now = this.now()
    this.#lowSince ??= now
    if (now - this.#lowSince < DOWNGRADE_AFTER_MS) return
    this.#networkAllowsHigh = false
    this.#lowSince = null
    this.onChange()
    this.#retry = setTimeout(() => {
      this.#networkAllowsHigh = true
      this.onChange()
    }, RETRY_HIGH_AFTER_MS)
  }

  close(): void {
    clearTimeout(this.#retry)
  }
}
