/** Each participant hears at most this many voices at once (PLAN §2 "Экономия трафика хоста"). */
export const FORWARDED_VOICES = 3

/**
 * Level reports come every 300 ms: about two seconds of silence free a slot — longer than the
 * pause between phrases, so a speaker is not cut off mid-thought.
 */
export const QUIET_TICKS = 7

/**
 * Picks the voices the host forwards. Up to three stay forwarded; a new loud voice takes the
 * place of the one that has been quiet the longest (and quiet for about two seconds), so people who
 * talk in turns keep their slot and nobody's voice flickers on and off.
 */
export class SpeakerSelector {
  readonly #known = new Set<string>()
  readonly #forwarded = new Set<string>()
  readonly #lastHeard = new Map<string, number>()
  #tick = 0

  constructor(
    private readonly limit = FORWARDED_VOICES,
    /** Intervals a forwarded voice must be silent before it can lose its slot. */
    private readonly quietTicks = QUIET_TICKS,
  ) {}

  get forwarded(): ReadonlySet<string> {
    return this.#forwarded
  }

  /** A new voice: forwarded right away while there is room. Returns whether anything changed. */
  add(producerId: string): boolean {
    this.#known.add(producerId)
    if (this.#forwarded.size >= this.limit) return false
    this.#forwarded.add(producerId)
    return true
  }

  /** A voice is gone; its slot goes to whoever was heard most recently. */
  remove(producerId: string): boolean {
    this.#known.delete(producerId)
    this.#lastHeard.delete(producerId)
    if (!this.#forwarded.delete(producerId)) return false
    const next = [...this.#known]
      .filter((id) => !this.#forwarded.has(id))
      .sort((a, b) => (this.#lastHeard.get(b) ?? -1) - (this.#lastHeard.get(a) ?? -1))[0]
    if (next !== undefined) this.#forwarded.add(next)
    return true
  }

  /**
   * Everyone heard in the last interval, loudest first. The loudest ones not yet forwarded take
   * the slot of a forwarded voice only if that one has been quiet for a while: while people keep
   * talking their voices stay, and equally loud speakers do not flap in and out.
   */
  heard(speaking: string[]): boolean {
    const now = ++this.#tick
    for (const id of speaking) if (this.#known.has(id)) this.#lastHeard.set(id, now)
    let changed = false
    for (const id of speaking.slice(0, this.limit)) {
      if (!this.#known.has(id) || this.#forwarded.has(id)) continue
      if (this.#forwarded.size < this.limit) {
        this.#forwarded.add(id)
        changed = true
        continue
      }
      const quietest = [...this.#forwarded]
        .filter((f) => now - (this.#lastHeard.get(f) ?? -Infinity) > this.quietTicks)
        .sort((a, b) => (this.#lastHeard.get(a) ?? -1) - (this.#lastHeard.get(b) ?? -1))[0]
      if (quietest === undefined) break
      this.#forwarded.delete(quietest)
      this.#forwarded.add(id)
      changed = true
    }
    return changed
  }
}
