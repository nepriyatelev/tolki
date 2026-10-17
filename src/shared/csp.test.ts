// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy } from './csp'

describe('contentSecurityPolicy', () => {
  it('is strict in production', () => {
    const csp = contentSecurityPolicy('production')

    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("style-src 'self'")
    expect(csp).not.toContain('unsafe-inline')
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).not.toContain('ws:')
  })

  it('relaxes only styles and the dev server websocket in development', () => {
    const csp = contentSecurityPolicy('development')

    expect(csp).toContain("script-src 'self';")
    expect(csp).toContain("style-src 'self' 'unsafe-inline'")
    expect(csp).toContain("connect-src 'self' ws://localhost:*")
    expect(csp).not.toContain('unsafe-eval')
  })
})
