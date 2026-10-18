/** The newest published release (pre-releases and drafts are not «latest»). */
export const LATEST_RELEASE_API =
  'https://api.github.com/repos/nepriyatelev/tolki-releases/releases/latest'

/** Every release, newest first: what an alpha or beta looks at (they are pre-releases). */
export const RELEASES_API =
  'https://api.github.com/repos/nepriyatelev/tolki-releases/releases?per_page=10'

export interface UpdateCheckOptions {
  /** Off: never contacts GitHub (e2e tests, development builds). */
  enabled: boolean
  /** This app's version, e.g. "0.1.0" or "0.1.0-alpha.2". */
  currentVersion: string
  fetch: (url: string, init: RequestInit) => Promise<Response>
  url?: string
  releasesUrl?: string
  timeoutMs?: number
}

export interface Version {
  core: [number, number, number]
  /** "alpha.2" → ['alpha', 2]; empty for a release. */
  pre: (string | number)[]
}

/** "v0.2.0", "0.2.0" or "0.2.0-alpha.1"; null for anything else. */
export function parseVersion(text: string): Version | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(text.trim())
  if (!match) return null
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: (match[4] ?? '')
      .split('.')
      .filter((id) => id !== '')
      .map((id) => (/^\d+$/.test(id) ? Number(id) : id)),
  }
}

/** By semver precedence: 0.1.0-alpha.1 < 0.1.0-alpha.2 < 0.1.0-beta.1 < 0.1.0 < 0.1.1. */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return (a.core[i] ?? 0) > (b.core[i] ?? 0)
  }
  // The release itself is newer than any of its pre-releases.
  if (a.pre.length === 0 || b.pre.length === 0) return a.pre.length === 0 && b.pre.length > 0
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i]
    const y = b.pre[i]
    if (x === y) continue
    if (x === undefined) return false
    if (y === undefined) return true
    if (typeof x === 'number' && typeof y === 'number') return x > y
    if (typeof x === 'number') return false
    if (typeof y === 'number') return true
    return x > y
  }
  return false
}

/**
 * «Доступна версия X» (PLAN #36): one anonymous request to the public releases repository per
 * launch. Nothing about the user or the app is sent; any failure just means no banner. A
 * release looks at the latest release only; an alpha or beta (#46) also at newer pre-releases.
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
    const prerelease = (parseVersion(this.options.currentVersion)?.pre.length ?? 0) > 0
    const url = prerelease
      ? (this.options.releasesUrl ?? RELEASES_API)
      : (this.options.url ?? LATEST_RELEASE_API)
    const response = await this.options.fetch(url, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
    })
    if (!response.ok) return null
    const body = await response.json()
    const tag = prerelease ? newestTag(body) : tagOf(body)
    if (tag === null || !isNewer(tag, this.options.currentVersion)) return null
    return { version: tag.trim().replace(/^v/, '') }
  }
}

function tagOf(release: unknown): string | null {
  if (typeof release !== 'object' || release === null) return null
  const { tag_name: tag, draft } = release as { tag_name?: unknown; draft?: unknown }
  return typeof tag === 'string' && draft !== true && parseVersion(tag) ? tag : null
}

/** The first published release in GitHub's list (newest first). */
function newestTag(releases: unknown): string | null {
  if (!Array.isArray(releases)) return null
  for (const release of releases) {
    const tag = tagOf(release)
    if (tag !== null) return tag
  }
  return null
}
