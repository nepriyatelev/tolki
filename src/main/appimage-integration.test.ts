import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DESKTOP_FILE, desktopEntry, integrateAppImage, quoteExec } from './appimage-integration'

let home: string
let icon: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'tolki-home-'))
  icon = join(home, 'icon.png')
  await writeFile(icon, 'png')
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

describe('desktopEntry', () => {
  it('handles tolki:// and passes the link as %u', () => {
    const entry = desktopEntry('/home/a/Apps/Tolki.AppImage')

    expect(entry).toContain('Exec="/home/a/Apps/Tolki.AppImage" %u\n')
    expect(entry).toContain('MimeType=x-scheme-handler/tolki;\n')
    expect(entry).toContain('StartupWMClass=tolki\n')
  })

  it('escapes characters that are special inside quoted Exec arguments', () => {
    expect(quoteExec('/home/a/My "Apps"/$x`y\\z.AppImage')).toBe(
      '"/home/a/My \\"Apps\\"/\\$x\\`y\\\\z.AppImage"',
    )
  })
})

describe('integrateAppImage', () => {
  it('writes the entry and icon and registers the scheme handler', async () => {
    const run = vi.fn(() => Promise.resolve())

    const changed = await integrateAppImage({
      appImagePath: '/apps/Tolki.AppImage',
      home,
      iconSource: icon,
      run,
    })

    expect(changed).toBe(true)
    const desktop = join(home, '.local/share/applications', DESKTOP_FILE)
    expect(await readFile(desktop, 'utf8')).toBe(desktopEntry('/apps/Tolki.AppImage'))
    expect((await stat(desktop)).mode & 0o777).toBe(0o644)
    expect(
      await readFile(join(home, '.local/share/icons/hicolor/256x256/apps/tolki.png'), 'utf8'),
    ).toBe('png')
    expect(run).toHaveBeenCalledWith('xdg-mime', [
      'default',
      DESKTOP_FILE,
      'x-scheme-handler/tolki',
    ])
  })

  it('does nothing when the entry is already up to date', async () => {
    const options = { appImagePath: '/apps/Tolki.AppImage', home, iconSource: icon }
    await integrateAppImage({ ...options, run: () => Promise.resolve() })
    const run = vi.fn(() => Promise.resolve())

    expect(await integrateAppImage({ ...options, run })).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it('rewrites the entry when the AppImage moved', async () => {
    await integrateAppImage({
      appImagePath: '/old/R.AppImage',
      home,
      iconSource: icon,
      run: () => Promise.resolve(),
    })

    expect(
      await integrateAppImage({
        appImagePath: '/new/R.AppImage',
        home,
        iconSource: icon,
        run: () => Promise.resolve(),
      }),
    ).toBe(true)
  })

  it('survives missing desktop tools and a missing icon', async () => {
    const run = () => Promise.reject(new Error('xdg-mime: not found'))

    await expect(
      integrateAppImage({ appImagePath: '/apps/R.AppImage', home, iconSource: '/nope.png', run }),
    ).resolves.toBe(true)
  })

  it('reports false instead of throwing when the home directory is not writable', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fileAsHome = join(home, 'file')
    await writeFile(fileAsHome, '')

    await expect(
      integrateAppImage({ appImagePath: '/a.AppImage', home: fileAsHome, iconSource: icon }),
    ).resolves.toBe(false)
    error.mockRestore()
  })
})
