/**
 * Content-Security-Policy for the renderer. The dev variant only adds what the Vite dev server
 * needs: inline <style> tags for CSS HMR and a websocket back to the server.
 */
export function contentSecurityPolicy(mode: 'development' | 'production'): string {
  const dev = mode === 'development'
  const directives: Record<string, string[]> = {
    'default-src': ["'none'"],
    'script-src': ["'self'"],
    'style-src': dev ? ["'self'", "'unsafe-inline'"] : ["'self'"],
    'img-src': ["'self'", 'data:'],
    'font-src': ["'self'"],
    'connect-src': dev ? ["'self'", 'ws://localhost:*'] : ["'self'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
  }
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ')
}
