import { defineConfig } from '@playwright/test'

// End-to-end tests drive the built app (`out/`) through Playwright's Electron support.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 1,
  // On CI: annotations for failures plus one line per test, so skips and their reasons show.
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
})
