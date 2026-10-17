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
  },
})
