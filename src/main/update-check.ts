/** The newest published release (pre-releases and drafts are not «latest»). */
export const LATEST_RELEASE_API =
  'https://api.github.com/repos/nepriyatelev/ratatosk-releases/releases/latest'

export interface UpdateCheckOptions {
  /** Off: never contacts GitHub (e2e tests, development builds). */
  enabled: boolean
  /** This app's version, e.g. "0.1.0". */
  currentVersion: string
  fetch: (url: string, init: RequestInit) => Promise<Response>
  url?: string
  timeoutMs?: number
}

/** "v0.2.0" or "0.2.0" → [0, 2, 0]; null for anything else. */
export function parseVersion(text: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text.trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

/**
 * «Доступна версия X» (PLAN #36): one anonymous request to the public releases repository per
 * launch. Nothing about the user or the app is sent; any failure just means no banner.
 */
export class UpdateCheck {
  #result: Promise<{ version: string } | null> | null = null

  constructor(private readonly options: UpdateCheckOptions) {}

  /** The newer version, if there is one; asked once per run. */
  check(): Promise<{ version: string } | null> {
    this.#result ??= this.#ask().catch(() => null)
    return this.#result
  }

  async #ask(): Promise<{ version: string } | null> {
    if (!this.options.enabled) return null
    const response = await this.options.fetch(this.options.url ?? LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
    })
    if (!response.ok) return null
    const { tag_name: tag } = (await response.json()) as { tag_name?: unknown }
    if (typeof tag !== 'string' || !isNewer(tag, this.options.currentVersion)) return null
    const version = parseVersion(tag)
    return version ? { version: version.join('.') } : null
  }
}
