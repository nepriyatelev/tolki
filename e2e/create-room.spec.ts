import { createServer, type AddressInfo } from 'node:net'
import { expect, test } from '@playwright/test'
import { launchApp } from './app'

async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => {
    probe.listen(0, resolve)
  })
  const { port } = probe.address() as AddressInfo
  await new Promise<void>((resolve) => {
    probe.close(() => {
      resolve()
    })
  })
  return port
}

test('a room is created and opened from the UI, and a friend can join it', async () => {
  const host = await launchApp()
  const port = await freePort()
  const page = host.page
  try {
    await page.getByRole('button', { name: 'Создать комнату' }).click()
    await expect(page.getByRole('heading', { name: 'Новая комната' })).toBeVisible()

    // e2e never touches the router, so the check says so and there is no public link.
    await expect(
      page.getByText('Автоматический проброс порта выключен', { exact: true }),
    ).toBeVisible()
    await expect(page.getByText(/Ссылку не из чего собрать/)).toBeVisible()

    await page.getByLabel('Название комнаты').fill('Вечерний созвон')
    await page.getByLabel('Твоё имя').fill('Дима')
    await page.getByRole('button', { name: 'Сгенерировать' }).click()
    const password = await page.getByLabel('Пароль', { exact: true }).inputValue()
    expect(password).toMatch(/^[а-яё]+-[а-яё]+-\d{2}$/)
    await page.getByText('Дополнительно').click()
    await page.getByLabel('Порт').fill(String(port))
    await page.getByLabel('Порт').blur()

    await page.getByRole('button', { name: 'Открыть комнату' }).click()
    await expect(
      page.getByText('Комната открыта, но из интернета к ней пока не подключиться.'),
    ).toBeVisible()

    const state = await page.evaluate(() => window.ratatosk.host.getState())
    expect(state).toMatchObject({ status: 'running', port })
    const fingerprint = await page.evaluate(() => window.ratatosk.host.getFingerprint())
    expect(state.status === 'running' && state.fingerprint).toBe(fingerprint)

    // A friend joins with the room's password; the host is already inside.
    const friend = await launchApp({
      args: [`ratatosk://join?v=1&h=127.0.0.1&p=${port}&r=room&fp=${fingerprint}`],
    })
    try {
      await friend.page.getByLabel('Твоё имя').fill('Катя')
      await friend.page.getByLabel('Пароль комнаты').fill(password)
      await friend.page.getByRole('button', { name: 'Войти в комнату' }).click()
      await expect(
        friend.page.getByText('Ты в комнате «Вечерний созвон». Участников вместе с тобой: 2.'),
      ).toBeVisible()
    } finally {
      await friend.app.close()
    }

    await page.getByRole('button', { name: 'Закрыть комнату' }).click()
    await expect(page.getByRole('button', { name: 'Открыть комнату' })).toBeVisible()
    expect(await page.evaluate(() => window.ratatosk.host.getState())).toEqual({
      status: 'stopped',
    })
  } finally {
    await host.app.close()
  }
})
