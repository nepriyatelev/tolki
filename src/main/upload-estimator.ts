import type { UploadMeasurement } from '@shared/upload-capacity'

export interface UploadEstimatorOptions {
  /** False when the user turned the speed test off (or RATATOSK_SPEED_TEST=off). */
  isEnabled: () => boolean
  measure: () => Promise<{ mbps: number }>
  /** A result is reused for this long: the test uploads tens of megabytes. */
  cacheMs?: number
  now?: () => number
}

/** Host upload before a call (PLAN #10). Never throws: problems become `failed`. */
export class UploadEstimator {
  #last: Extract<UploadMeasurement, { status: 'measured' }> | null = null
  #pending: Promise<UploadMeasurement> | null = null
  readonly #cacheMs: number
  readonly #now: () => number

  constructor(private readonly options: UploadEstimatorOptions) {
    this.#cacheMs = options.cacheMs ?? 30 * 60_000
    this.#now = options.now ?? Date.now
  }

  measure({ force = false }: { force?: boolean } = {}): Promise<UploadMeasurement> {
    if (!this.options.isEnabled()) return Promise.resolve({ status: 'disabled' })
    if (this.#pending) return this.#pending
    if (!force && this.#last && this.#now() - this.#last.measuredAt < this.#cacheMs) {
      return Promise.resolve(this.#last)
    }

    this.#pending = this.#run().finally(() => {
      this.#pending = null
    })
    return this.#pending
  }

  async #run(): Promise<UploadMeasurement> {
    try {
      const { mbps } = await this.options.measure()
      this.#last = { status: 'measured', mbps, measuredAt: this.#now() }
      return this.#last
    } catch (error) {
      return { status: 'failed', detail: error instanceof Error ? error.message : String(error) }
    }
  }
}
