import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import solid from 'vite-plugin-solid'
import { contentSecurityPolicy } from './src/shared/csp'

const shared = resolve(__dirname, 'src/shared')

/** Injects the CSP <meta> tag, strict in production and relaxed only for the dev server. */
function csp(): Plugin {
  let mode: 'development' | 'production' = 'production'
  return {
    name: 'ratatosk-csp',
    configResolved(config) {
      mode = config.command === 'serve' ? 'development' : 'production'
    },
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: contentSecurityPolicy(mode) },
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          host: resolve(__dirname, 'src/host/index.ts'),
        },
      },
    },
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
  },
  renderer: {
    resolve: { alias: { '@shared': shared } },
    plugins: [solid(), csp()],
    build: {
      // Fonts must stay files: the CSP allows font-src 'self' but not data: URIs.
      assetsInlineLimit: (file) => (file.endsWith('.woff2') ? false : undefined),
    },
  },
})
