import { randomBytes } from 'node:crypto'

export const CLOUDFLARE_UPLOAD_URL = 'https://speed.cloudflare.com/__up'

export interface SpeedTestOptions {
  fetch?: (url: string, init: RequestInit) => Promise<Response>
  /** Monotonic clock in ms. */
  now?: () => number
  endpoint?: string
  /** Stop starting new uploads after this long. */
  budgetMs?: number
  maxBytes?: number
  /** An upload round this slow is long enough to trust; stop there. */
  targetRequestMs?: number
  /**
   * Concurrent uploads per round. One TCP stream under-reports on high-latency links, and a
   * host sends to many participants at once anyway.
   */
  parallel?: number
}

/**
 * Measures upload speed with rounds of parallel POSTs of growing size until a round takes long
 * enough to be accurate (small uploads under-report because of TCP slow start) or the time
 * budget runs out. Throws if no upload succeeded.
 */
export async function measureUpload(options: SpeedTestOptions = {}): Promise<{ mbps: number }> {
  const fetchFn = options.fetch ?? fetch
  const now = options.now ?? (() => performance.now())
  const endpoint = options.endpoint ?? CLOUDFLARE_UPLOAD_URL
  const budgetMs = options.budgetMs ?? 8000
  // Per upload; with 4 in parallel a whole test sends at most ~64 MB.
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024
  const targetRequestMs = options.targetRequestMs ?? 1500
  const parallel = options.parallel ?? 4

  // Random bytes: a compressing proxy must not make the link look faster than it is.
  const payload = randomBytes(maxBytes)
  const started = now()

  const post = async (size: number): Promise<number> => {
    const t0 = now()
    const response = await fetchFn(endpoint, {
      method: 'POST',
      body: payload.subarray(0, size),
      signal: AbortSignal.timeout(budgetMs + 10_000),
    })
    await response.arrayBuffer()
    if (!response.ok) throw new Error(`speed test server answered ${response.status}`)
    return now() - t0
  }

  // Round-trip time of an empty upload is overhead, not transfer time.
  const rtt = Math.min(await post(0), await post(0))

  const samples: number[] = []
  for (let size = 256 * 1024; size <= maxBytes && now() - started < budgetMs; size *= 2) {
    const t0 = now()
    await Promise.all(Array.from({ length: parallel }, () => post(size)))
    const elapsed = now() - t0
    samples.push((parallel * size * 8) / Math.max(elapsed - rtt, 1) / 1000)
    if (elapsed >= targetRequestMs) break
  }
  if (samples.length === 0) throw new Error('speed test made no measurements')

  // The largest uploads are the most accurate.
  return { mbps: Math.max(...samples.slice(-2)) }
}
