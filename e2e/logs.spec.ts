import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { launchApp } from './app'
import { freePort } from './ports'

// #106: «Помощь → Сохранить логи…» writes one text file with what is needed to sort a problem
// out — and nothing about the people, the room or its password.

const FAKE_MEDIA = '--use-fake-device-for-media-stream'
const ROOM = 'Секретная комната'
const PASSWORD = 'лиса-маяк-42'
const ORGANIZER = 'Организатор Пётр'
const GUEST = 'Гостья Мария'

/** Clicks the menu item the way a user would and returns the saved file's text. */
async function saveLogs(app: ElectronApplication): Promise<string> {
  const downloads = mkdtempSync(join(tmpdir(), 'tolki-downloads-'))
  await app.evaluate(({ app: electronApp, Menu }, dir) => {
    electronApp.setPath('downloads', dir)
    Menu.getApplicationMenu()?.getMenuItemById('save-logs')?.click()
  }, downloads)
  await expect.poll(() => readdirSync(downloads).length, { timeout: 10_000 }).toBe(1)
  const [name = ''] = readdirSync(downloads)
  expect(name).toMatch(/^tolki-logs-\d{4}-\d{2}-\d{2}-\d{4}\.txt$/)
  return readFileSync(join(downloads, name), 'utf8')
}

test('saved logs tell what happened without names, the room, its password or the link', async () => {
  test.setTimeout(90_000)
  const host = await launchApp({ args: [FAKE_MEDIA] })
  try {
    const port = await freePort()
    const state = await host.page.evaluate(
      ({ p, name, password }) =>
        window.tolki.host.start({ port: p, portMapping: false, roomName: name, password }),
      { p: port, name: ROOM, password: PASSWORD },
    )
    if (state.status !== 'running') throw new Error('host did not start')
    const link = `tolki://join?v=1&h=127.0.0.1&p=${port}&r=sekret&fp=${state.fingerprint}`
    await host.page.getByLabel('Ссылка-приглашение').fill(link)
    await host.page.getByRole('button', { name: 'Войти', exact: true }).click()
    await host.page.getByLabel('Имя', { exact: true }).fill(ORGANIZER)
    await host.page.getByLabel('Пароль комнаты').fill(PASSWORD)
    await host.page.getByRole('button', { name: 'Войти в комнату' }).click()
    await expect(host.page.getByText('Звук подключён')).toBeVisible()

    const guest = await launchApp({ args: [FAKE_MEDIA, link] })
    try {
      await guest.page.getByLabel('Имя', { exact: true }).fill(GUEST)
      await guest.page.getByLabel('Пароль комнаты').fill(PASSWORD)
      await guest.page.getByRole('button', { name: 'Войти в комнату' }).click()
      await expect(guest.page.getByText('Звук подключён')).toBeVisible()
      // Both hear each other, so both transports are connected before the logs are saved.
      await expect(guest.page.locator('audio[data-peer-id]')).toHaveCount(1, { timeout: 15_000 })
      await expect(host.page.locator('audio[data-peer-id]')).toHaveCount(1, { timeout: 15_000 })

      for (const [app, role] of [
        [host.app, 'organizer'],
        [guest.app, 'guest'],
      ] as const) {
        // The transports report «connected» a moment after the voices start: save until it is in.
        let text = ''
        await expect
          .poll(
            async () => {
              text = await saveLogs(app)
              return text
            },
            { timeout: 15_000 },
          )
          .toMatch(/\[renderer\] \[info\]\s+\[call\] (send|recv) transport connected/)
        // Nothing personal or secret…
        for (const secret of [ROOM, PASSWORD, ORGANIZER, GUEST, 'Пётр', 'Мария', 'tolki://']) {
          expect(text, `${role}: «${secret}» must not be in the logs`).not.toContain(secret)
        }
        expect(text, `${role}: the full fingerprint`).not.toContain(state.fingerprint)
        // …but what happened, under pseudonyms.
        expect(text).toMatch(/^Tolki \S+ — saved /)
        expect(text).toContain('OS: ')
        expect(text).toMatch(/\[main\] \[info\]\s+room join: ipv4 127\.0\.0\.1 port \d+/)
        expect(text).toMatch(/joined комната sekr as участник [0-9a-f]{4}/)
        expect(text).toMatch(/\[renderer\] \[info\]\s+\[call\] started: microphone on/)
        if (role === 'organizer') {
          expect(text).toMatch(/\[main\] \[info\]\s+host start: port \d+, port mapping off/)
          expect(text).toMatch(/\[host\] \[info\]\s+room open on port \d+/)
          expect(text).toMatch(/\[host\] \[info\]\s+участник [0-9a-f]{4} joined, 2 in the room/)
        }
      }
    } finally {
      await guest.app.close()
    }
  } finally {
    await host.app.close()
  }
})
