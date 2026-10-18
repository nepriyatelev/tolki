import { defineConfig } from '@playwright/test'

// Measurements run on their own (`pnpm perf:load`, `perf:share`, `perf:budgets`), not in e2e.
export default defineConfig({
  testDir: '.',
  testMatch: ['load.spec.ts', 'share.spec.ts', 'budgets.spec.ts'],
  timeout: 600_000,
  workers: 1,
  reporter: 'list',
})
