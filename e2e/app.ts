import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
  /** Isolated userData directory used by this launch. */
  userDataDir: string
}

/**
 * Launches the app from `out/` by default. Set E2E_EXECUTABLE to a packaged binary
 * (e.g. release/mac-arm64/Ratatosk.app/Contents/MacOS/Ratatosk) to test an installer build.
 * Every launch gets a fresh userData directory unless one is passed in.
 */
export async function launchApp(options: { userDataDir?: string } = {}): Promise<LaunchedApp> {
  const userDataDir = options.userDataDir ?? mkdtempSync(join(tmpdir(), 'ratatosk-e2e-'))
  // e2e must never change the router or upload to speed.cloudflare.com.
  const env = {
    ...process.env,
    RATATOSK_USER_DATA: userDataDir,
    RATATOSK_PORT_MAPPING: 'off',
    RATATOSK_SPEED_TEST: 'off',
  } as Record<string, string>
  const executablePath = process.env['E2E_EXECUTABLE']
  const app = await electron.launch(executablePath ? { executablePath, env } : { args: ['.'], env })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page, userDataDir }
}
