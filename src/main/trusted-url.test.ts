// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { isTrustedRendererUrl } from './trusted-url'

const indexFileUrl =
  'file:///Applications/Ratatosk.app/Contents/Resources/app.asar/out/renderer/index.html'

describe('isTrustedRendererUrl', () => {
  describe('production (bundled index.html)', () => {
    const renderer = { indexFileUrl }

    it('accepts the bundled index.html, with or without hash and query', () => {
      expect(isTrustedRendererUrl(indexFileUrl, renderer)).toBe(true)
      expect(isTrustedRendererUrl(`${indexFileUrl}#/call`, renderer)).toBe(true)
      expect(isTrustedRendererUrl(`${indexFileUrl}?x=1`, renderer)).toBe(true)
    })

    it('rejects other local files and remote pages', () => {
      expect(isTrustedRendererUrl('file:///etc/passwd', renderer)).toBe(false)
      expect(isTrustedRendererUrl('https://example.com/index.html', renderer)).toBe(false)
      expect(isTrustedRendererUrl('http://localhost:5173/', renderer)).toBe(false)
    })

    it('rejects garbage', () => {
      expect(isTrustedRendererUrl('', renderer)).toBe(false)
      expect(isTrustedRendererUrl('not a url', renderer)).toBe(false)
    })
  })

  describe('development (Vite dev server)', () => {
    const renderer = { devServerUrl: 'http://localhost:5173/', indexFileUrl }

    it('accepts any page of the dev server origin', () => {
      expect(isTrustedRendererUrl('http://localhost:5173/', renderer)).toBe(true)
      expect(isTrustedRendererUrl('http://localhost:5173/src/index.tsx', renderer)).toBe(true)
    })

    it('rejects other ports, hosts and file URLs', () => {
      expect(isTrustedRendererUrl('http://localhost:5174/', renderer)).toBe(false)
      expect(isTrustedRendererUrl('http://127.0.0.1:5173/', renderer)).toBe(false)
      expect(isTrustedRendererUrl(indexFileUrl, renderer)).toBe(false)
    })
  })
})
