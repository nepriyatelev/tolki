import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

/**
 * Launches the app from `out/` by default. Set E2E_EXECUTABLE to a packaged binary
 * (e.g. release/mac-arm64/Ratatosk.app/Contents/MacOS/Ratatosk) to test an installer build.
 */
export async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const executablePath = process.env['E2E_EXECUTABLE']
  const app = await electron.launch(executablePath ? { executablePath } : { args: ['.'] })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}
