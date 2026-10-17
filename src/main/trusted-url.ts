/**
 * Decides whether a URL belongs to our own renderer: the Vite dev server origin in development,
 * or the bundled index.html in production. Used to vet IPC senders and navigations.
 */
export function isTrustedRendererUrl(
  url: string,
  renderer: { devServerUrl?: string | undefined; indexFileUrl: string },
): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (renderer.devServerUrl !== undefined) {
    return parsed.origin === new URL(renderer.devServerUrl).origin
  }

  if (parsed.protocol !== 'file:') return false
  const index = new URL(renderer.indexFileUrl)
  return parsed.pathname === index.pathname
}

/**
 * Same decision for permission checks, which only see an origin: the dev server origin in
 * development, the file:// origin of the bundled renderer in production.
 */
export function isTrustedRendererOrigin(
  origin: string,
  renderer: { devServerUrl?: string | undefined },
): boolean {
  if (renderer.devServerUrl !== undefined) {
    try {
      return origin === new URL(renderer.devServerUrl).origin
    } catch {
      return false
    }
  }
  return origin === 'file://' || origin === 'file:///'
}
