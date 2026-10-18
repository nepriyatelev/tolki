import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// Builds the load test's participant page (PLAN #33) into perf/.build.
export default defineConfig({
  root: resolve(__dirname, 'client'),
  base: './',
  resolve: { alias: { '@shared': resolve(__dirname, '../src/shared') } },
  build: { outDir: resolve(__dirname, '.build'), emptyOutDir: true },
  logLevel: 'warn',
})
