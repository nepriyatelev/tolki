import { resolve } from 'node:path'
import solid from 'vite-plugin-solid'
import { defineConfig } from 'vitest/config'

const alias = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', 'src/test/**', '**/*.d.ts'],
      reporter: ['text-summary'],
      thresholds: {
        // PLAN #11: the invite parser guards what we connect to; every branch is tested.
        'src/shared/invite.ts': { lines: 100, branches: 100, functions: 100, statements: 100 },
      },
    },
    projects: [
      {
        // Renderer: Solid components in jsdom, browser builds of dependencies.
        plugins: [solid()],
        resolve: { alias, conditions: ['development', 'browser'] },
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['src/renderer/**/*.test.{ts,tsx}'],
          setupFiles: ['src/test/setup.ts'],
          // tokens.test.ts reads tokens.css?raw; other CSS stays stubbed out.
          css: { include: [/tokens\.css/] },
        },
      },
      {
        // Main, host and shared code: plain Node, Node builds of dependencies (e.g. ws).
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/{main,host,shared}/**/*.test.ts'],
        },
      },
    ],
  },
})
