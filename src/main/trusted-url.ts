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
