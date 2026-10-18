import { execFile } from 'node:child_process'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const DESKTOP_FILE = 'tolki.desktop'
const ICON_NAME = 'tolki'
const SCHEME_MIME = 'x-scheme-handler/tolki'

/** Quotes a path for the Exec key (Desktop Entry spec, "Exec variables"). */
export function quoteExec(path: string): string {
  return `"${path.replace(/[\\"`$]/g, (c) => `\\${c}`)}"`
}

export function desktopEntry(appImagePath: string): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Tolki',
    'Comment=Голосовые звонки и демонстрация экрана',
    `Exec=${quoteExec(appImagePath)} %u`,
    `Icon=${ICON_NAME}`,
    'Terminal=false',
    'Categories=Network;',
    `MimeType=${SCHEME_MIME};`,
    // Matches desktopName in package.json, so windows group under this entry.
    'StartupWMClass=tolki',
    '',
  ].join('\n')
}

export interface AppImageIntegrationOptions {
  /** $APPIMAGE: where the user keeps the AppImage file. */
  appImagePath: string
  home: string
  /** PNG shipped in resources. */
  iconSource: string
  run?: (command: string, args: string[]) => Promise<unknown>
}

/**
 * AppImages are not installed, so nothing registers tolki:// links for them. On start we
 * write a user-level .desktop entry pointing at the current AppImage path and make it the
 * handler for the scheme. Rewritten only when the file moved. Never throws.
 */
export async function integrateAppImage(options: AppImageIntegrationOptions): Promise<boolean> {
  const run = options.run ?? ((command, args) => execFileAsync(command, args))
  const applications = join(options.home, '.local/share/applications')
  const desktopPath = join(applications, DESKTOP_FILE)
  const entry = desktopEntry(options.appImagePath)

  try {
    const current = await readFile(desktopPath, 'utf8').catch(() => null)
    if (current === entry) return false

    await mkdir(applications, { recursive: true })
    await writeFile(desktopPath, entry, { mode: 0o644 })

    const icons = join(options.home, '.local/share/icons/hicolor/256x256/apps')
    await mkdir(icons, { recursive: true })
    await copyFile(options.iconSource, join(icons, `${ICON_NAME}.png`)).catch(() => undefined)

    // Best effort: desktops without these tools still pick the entry up from the MimeType key.
    await run('xdg-mime', ['default', DESKTOP_FILE, SCHEME_MIME]).catch(() => undefined)
    await run('update-desktop-database', [applications]).catch(() => undefined)
    return true
  } catch (error) {
    console.error('[main] AppImage desktop integration failed:', error)
    return false
  }
}
