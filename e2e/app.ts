import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import electronBinary from 'electron'

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
  /** Isolated userData directory used by this launch. */
  userDataDir: string
}

/** e2e must never change the router or upload to speed.cloudflare.com. */
function appEnv(userDataDir: string): Record<string, string> {
  return {
    ...process.env,
    RATATOSK_USER_DATA: userDataDir,
    RATATOSK_PORT_MAPPING: 'off',
    RATATOSK_SPEED_TEST: 'off',
  }
}

/**
 * Launches the app from `out/` by default. Set E2E_EXECUTABLE to a packaged binary
 * (e.g. release/mac-arm64/Ratatosk.app/Contents/MacOS/Ratatosk) to test an installer build.
 * Every launch gets a fresh userData directory unless one is passed in.
 */
export async function launchApp(
  options: { userDataDir?: string; args?: string[] } = {},
): Promise<LaunchedApp> {
  const userDataDir = options.userDataDir ?? mkdtempSync(join(tmpdir(), 'ratatosk-e2e-'))
  const env = appEnv(userDataDir)
  const executablePath = process.env['E2E_EXECUTABLE']
  const extra = options.args ?? []
  const app = await electron.launch(
    executablePath ? { executablePath, args: extra, env } : { args: ['.', ...extra], env },
  )
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page, userDataDir }
}

/**
 * Starts a second instance the way the OS does for a clicked link (outside Playwright).
 * Resolves with its exit code; with a running first instance it should quit right away.
 */
export function launchSecondInstance(userDataDir: string, args: string[]): Promise<number | null> {
  const executablePath = process.env['E2E_EXECUTABLE']
  const env = appEnv(userDataDir)
  const child = executablePath
    ? spawn(executablePath, args, { env })
    : spawn(electronBinary as unknown as string, ['.', ...args], { env })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('second instance did not quit'))
    }, 15_000)
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
}
