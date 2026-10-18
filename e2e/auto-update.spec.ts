import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp } from './app'

// PLAN #46: the new version downloads in the background, then the home screen offers
// «Перезапустить». A local feed stands in for tolki-releases; the test ends at «downloaded»
// and installs nothing (electron-updater's AppImage updater, on any OS, as far as the download).

const INSTALLER = Buffer.from('not really an AppImage, but the checksum matches')

async function feed(): Promise<{ server: Server; url: string; requests: IncomingMessage[] }> {
  const sha512 = createHash('sha512').update(INSTALLER).digest('base64')
  const requests: IncomingMessage[] = []
  const server = createServer((request, response) => {
    requests.push(request)
    const path = new URL(request.url ?? '/', 'http://feed').pathname
    if (path.endsWith('.yml')) {
      // latest.yml, latest-mac.yml or latest-linux.yml: whichever this OS asks for.
      response.end(
        [
          'version: 99.0.0',
          'files:',
          '  - url: Tolki-99.0.0.AppImage',
          `    sha512: ${sha512}`,
          `    size: ${INSTALLER.length}`,
          'path: Tolki-99.0.0.AppImage',
          `sha512: ${sha512}`,
          "releaseDate: '2026-10-18T00:00:00.000Z'",
        ].join('\n'),
      )
    } else if (path === '/Tolki-99.0.0.AppImage') {
      response.setHeader('Content-Length', INSTALLER.length)
      response.end(INSTALLER)
    } else {
      response.statusCode = 404
      response.end()
    }
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address() as AddressInfo
  return { server, url: `http://127.0.0.1:${port}`, requests }
}

/** Where electron-updater keeps a downloaded update, per OS. */
function cacheBase(): string {
  if (process.platform === 'win32') {
    return process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local')
  }
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches')
  return process.env['XDG_CACHE_HOME'] ?? join(homedir(), '.cache')
}

test('a downloaded update offers «Перезапустить» on the home screen', async () => {
  const releases = await feed()
  const dir = mkdtempSync(join(tmpdir(), 'tolki-update-'))
  const cacheDir = `tolki-updater-e2e-${randomUUID()}`
  const config = join(dir, 'app-update.yml')
  writeFileSync(
    config,
    `provider: generic\nurl: ${releases.url}\nupdaterCacheDirName: ${cacheDir}\n`,
  )
  // The AppImage being replaced: only its path is needed, nothing is installed.
  const appImage = join(dir, 'Tolki.AppImage')
  writeFileSync(appImage, '')
  const { app, page } = await launchApp({
    env: { TOLKI_UPDATE_CHECK: 'on', TOLKI_UPDATE_CONFIG: config, APPIMAGE: appImage },
  })
  try {
    await expect(
      page.getByText('Версия 99.0.0 загружена и установится при выходе из Tolki'),
    ).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'Перезапустить' })).toBeVisible()
    expect(releases.requests.some((r) => r.url?.startsWith('/Tolki-99.0.0.AppImage'))).toBe(true)
    // Plain GETs: no cookies, nothing that identifies the user.
    expect(releases.requests.every((r) => r.method === 'GET' && !r.headers.cookie)).toBe(true)
    await page.screenshot({ path: test.info().outputPath('update-ready.png') })
  } finally {
    await app.close()
    releases.server.close()
    rmSync(dir, { recursive: true, force: true })
    rmSync(join(cacheBase(), cacheDir), { recursive: true, force: true })
  }
})
