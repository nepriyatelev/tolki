import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test'
import electronBinary from 'electron'

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
  /** Isolated userData directory used by this launch. */
  userDataDir: string
}

/** e2e must never change the router, upload to speed.cloudflare.com, ask GitHub for updates or open folders. */
function appEnv(userDataDir: string): Record<string, string> {
  return {
    ...process.env,
    TOLKI_USER_DATA: userDataDir,
    TOLKI_PORT_MAPPING: 'off',
    TOLKI_SPEED_TEST: 'off',
    TOLKI_UPDATE_CHECK: 'off',
    // «Сохранить логи…» must not open Finder / Explorer windows (#106).
    TOLKI_SHOW_IN_FOLDER: 'off',
    TOLKI_OPEN_LINKS: 'off',
    // Nothing asked about OS permissions (#85): a CI runner has nobody to answer a dialog.
    TOLKI_OS_PERMISSIONS: 'skip',
    // No STUN server and no public port checker (#128).
    TOLKI_REACHABILITY: 'off',
    // The viewer's stream follows the window size only: a runner's estimate measures its
    // software encoder, not the network (#34; the network side is unit-tested).
    TOLKI_SCREEN_BY_NETWORK: 'off',
    // Push-to-talk keeps to the focused window: no hook on the real keyboard, no macOS prompt.
    TOLKI_GLOBAL_KEYS: 'off',
  }
}

/**
 * The first screen in «Что показать». Not just the first radio: the mode buttons (#86) are
 * radios too, and with the screens listed late «Авто» would come first.
 */
export function firstScreen(dialog: Locator): Locator {
  return dialog.getByRole('radiogroup', { name: 'Экраны' }).getByRole('radio').first()
}

/**
 * Launches the app from `out/` by default. Set E2E_EXECUTABLE to a packaged binary
 * (e.g. release/mac-arm64/Tolki.app/Contents/MacOS/Tolki) to test an installer build.
 * Every launch gets a fresh userData directory unless one is passed in.
 */
export async function launchApp(
  options: { userDataDir?: string; args?: string[]; env?: Record<string, string> } = {},
): Promise<LaunchedApp> {
  const userDataDir = options.userDataDir ?? mkdtempSync(join(tmpdir(), 'tolki-e2e-'))
  const env = { ...appEnv(userDataDir), ...options.env }
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
