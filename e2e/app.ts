import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

export async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: ['.'] })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}
