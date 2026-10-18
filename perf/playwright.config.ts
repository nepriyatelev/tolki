import { defineConfig } from '@playwright/test'

// The load test (PLAN #33) runs on its own: `pnpm perf:load`. Not part of the e2e suite.
export default defineConfig({
  testDir: '.',
  testMatch: 'load.spec.ts',
  timeout: 240_000,
  workers: 1,
  reporter: 'list',
})
