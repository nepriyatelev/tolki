/** Each participant hears at most this many voices at once (PLAN §2 "Экономия трафика хоста"). */
export const FORWARDED_VOICES = 3

/**
 * Picks the voices the host forwards. Up to three stay forwarded; a new loud voice takes the
 * place of the one that has been quiet the longest, so people who talk in turns keep their slot
 * and nobody's voice flickers on and off.
 */
export class SpeakerSelector {
  readonly #known = new Set<string>()
  readonly #forwarded = new Set<string>()
  readonly #lastHeard = new Map<string, number>()
  #tick = 0

  constructor(private readonly limit = FORWARDED_VOICES) {}

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

  /** The loudest voices of the last interval, loudest first. */
  heard(loudest: string[]): boolean {
    const now = ++this.#tick
    for (const id of loudest) if (this.#known.has(id)) this.#lastHeard.set(id, now)
    let changed = false
    for (const id of loudest) {
      if (!this.#known.has(id) || this.#forwarded.has(id)) continue
      if (this.#forwarded.size < this.limit) {
        this.#forwarded.add(id)
        changed = true
        continue
      }
      const quietest = [...this.#forwarded]
        .filter((f) => !loudest.includes(f))
        .sort((a, b) => (this.#lastHeard.get(a) ?? -1) - (this.#lastHeard.get(b) ?? -1))[0]
      if (quietest === undefined) break
      this.#forwarded.delete(quietest)
      this.#forwarded.add(id)
      changed = true
    }
    return changed
  }
}
