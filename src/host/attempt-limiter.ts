/**
 * At most `limit` failed password attempts per address within `windowMs` (PLAN #13: 5 per minute).
 * Once the limit is reached the address is blocked until its oldest failure leaves the window,
 * even for a correct password, so guessing cannot continue.
 */
export class AttemptLimiter {
  readonly #failures = new Map<string, number[]>()

  constructor(
    private readonly limit = 5,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  isBlocked(address: string): boolean {
    return this.#recent(address).length >= this.limit
  }

  recordFailure(address: string): void {
    this.#failures.set(address, [...this.#recent(address), this.now()])
  }

  #recent(address: string): number[] {
    const since = this.now() - this.windowMs
    const recent = (this.#failures.get(address) ?? []).filter((t) => t > since)
    if (recent.length === 0) this.#failures.delete(address)
    else this.#failures.set(address, recent)
    return recent
  }
}

/** "::ffff:127.0.0.1" and "127.0.0.1" are the same client. */
export function normalizeAddress(address: string | undefined): string {
  if (address === undefined) return 'unknown'
  return address.startsWith('::ffff:') ? address.slice(7) : address
}
