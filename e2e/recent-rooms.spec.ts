import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { freePort } from './ports'
import { launchApp } from './app'

test('a joined room shows up in recent rooms with its live status and saved password', async () => {
  const host = await launchApp()
  const port = await freePort()
  const state = await host.page.evaluate(
    (p) =>
      window.ratatosk.host.start({
        port: p,
        portMapping: false,
        roomName: 'Вечерний созвон',
        password: 'лиса-маяк-42',
      }),
    port,
  )
  if (state.status !== 'running') throw new Error('host did not start')
  const link = `ratatosk://join?v=1&h=127.0.0.1&p=${port}&r=vecherniy&fp=${state.fingerprint}`

  const client = await launchApp({ args: [link] })
  const page = client.page
  try {
    // Join once with the password typed by hand.
    await page.getByLabel('Имя').fill('Алексей')
    await page.getByLabel('Пароль комнаты').fill('лиса-маяк-42')
    await page.getByRole('button', { name: 'Войти в комнату' }).click()
    await expect(page.getByRole('heading', { name: 'Вечерний созвон' })).toBeVisible()
    await page.getByRole('button', { name: 'Выйти' }).click()
    await page.getByRole('button', { name: 'Отмена' }).click()

    // Home: the name in the header (no greeting, #88), recent room with only the number of people.
    await expect(page.locator('.app-user')).toContainText('Алексей')
    const row = page.getByRole('listitem').filter({ hasText: 'Вечерний созвон' })
    await expect(row).toBeVisible()
    await expect(row.getByText('Запущена · пока никого')).toBeVisible()

    // The password is never on disk in plain text.
    const file = readFileSync(join(client.userDataDir, 'recent-rooms.json'), 'utf8')
    expect(file).not.toContain('лиса-маяк-42')
    const saved = process.platform !== 'linux' // Linux CI has no keyring: nothing is saved there
    if (saved) await expect(row.getByText(/пароль сохранён/)).toBeVisible()

    // Rejoin from the list: no password field when it was saved.
    await row.getByRole('button', { name: 'Подключиться' }).click()
    await expect(page.getByLabel('Имя')).toHaveValue('Алексей')
    if (saved) {
      await expect(page.getByLabel('Пароль комнаты')).toHaveCount(0)
    } else {
      await page.getByLabel('Пароль комнаты').fill('лиса-маяк-42')
    }
    await page.getByRole('button', { name: 'Войти в комнату' }).click()
    await expect(page.getByRole('heading', { name: 'Вечерний созвон' })).toBeVisible()
    await page.getByRole('button', { name: 'Выйти' }).click()
    await page.getByRole('button', { name: 'Отмена' }).click()

    // Someone else is inside now: the list shows the count, never names.
    const joined = await host.page.evaluate(
      ({ p, fp }) =>
        window.ratatosk.room.join({
          invite: {
            host: '127.0.0.1',
            hostKind: 'ipv4',
            port: p,
            roomId: 'vecherniy',
            fingerprint: fp,
          },
          name: 'Дима',
          password: 'лиса-маяк-42',
        }),
      { p: port, fp: state.fingerprint },
    )
    expect(joined.ok).toBe(true)
    await page.reload()
    const liveRow = page.getByRole('listitem').filter({ hasText: 'Вечерний созвон' })
    await expect(liveRow.getByText('Идёт · 1 человек')).toBeVisible()
    await expect(liveRow.getByText('Дима')).toHaveCount(0)

    // Host goes away: the next visit of the home screen shows it.
    await host.page.evaluate(() => window.ratatosk.host.stop())
    await page.reload()
    await expect(
      page
        .getByRole('listitem')
        .filter({ hasText: 'Вечерний созвон' })
        .getByText('Организатор не в сети'),
    ).toBeVisible()
  } finally {
    await client.app.close()
    await host.app.close()
  }
})
