import { resolve } from 'node:path'
import solid from 'vite-plugin-solid'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [solid()],
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') },
    conditions: ['development', 'browser'],
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    // tokens.test.ts reads tokens.css?raw; other CSS stays stubbed out.
    css: { include: [/tokens\.css/] },
  },
})
