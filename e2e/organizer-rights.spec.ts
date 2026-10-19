import { expect, test } from '@playwright/test'
import { launchApp } from './app'
import { freePort } from './ports'

// #42: entry by approval, «Впустить», removing someone — through both apps' interfaces.

const FAKE_MEDIA = '--use-fake-device-for-media-stream'

test('the organizer lets a guest in, removes them, and lets them back without approval', async () => {
  test.setTimeout(120_000)
  const host = await launchApp({ args: [FAKE_MEDIA] })
  const port = await freePort()
  const page = host.page
  try {
    await page.getByRole('button', { name: 'Создать комнату' }).click()
    await page.getByLabel('Название комнаты').fill('Своя')
    await page.getByLabel('Имя').fill('Дима')
    await page.getByText('Подтверждать вход').click()
    await page.getByText('Дополнительно').click()
    await page.getByLabel('Порт').fill(String(port))
    await page.getByLabel('Порт').blur()
    await page.getByRole('button', { name: 'Открыть комнату' }).click()
    await expect(page.getByText('Звук подключён')).toBeVisible()
    await page.getByRole('button', { name: 'Меню комнаты' }).click()
    await expect(page.getByRole('checkbox', { name: 'Подтверждать вход' })).toBeChecked()
    await page.keyboard.press('Escape')

    const fingerprint = await page.evaluate(() => window.tolki.host.getFingerprint())
    const guest = await launchApp({
      args: [FAKE_MEDIA, `tolki://join?v=1&h=127.0.0.1&p=${port}&r=svoya&fp=${fingerprint}`],
    })
    try {
      const g = guest.page
      await expect(g.getByText('Вход подтверждает организатор', { exact: true })).toBeVisible()
      await g.getByLabel('Имя').fill('Катя')
      await g.getByRole('button', { name: 'Войти в комнату' }).click()
      await expect(g.getByText('Вход подтверждает организатор — нужно подождать.')).toBeVisible()

      // The organizer lets her in.
      await expect(page.getByText('Катя просит впустить')).toBeVisible()
      await page.getByRole('button', { name: 'Впустить' }).click()
      await expect(g.getByText('Звук подключён')).toBeVisible()
      await expect(page.getByRole('list', { name: 'Участники' }).getByRole('listitem')).toHaveCount(
        2,
      )

      // …and removes her.
      await page.getByRole('button', { name: 'Меню: Катя' }).click()
      await page.getByRole('button', { name: 'Удалить из комнаты' }).click()
      await page.getByRole('button', { name: 'Удалить', exact: true }).click()
      await expect(g.getByRole('heading', { name: 'Удаление из комнаты' })).toBeVisible()
      await expect(page.getByRole('list', { name: 'Участники' }).getByRole('listitem')).toHaveCount(
        1,
      )

      // She may try again: she waits again, until entry by approval is turned off.
      await g.getByRole('button', { name: 'Попробовать снова' }).click()
      await g.getByLabel('Имя').fill('Катя')
      await g.getByRole('button', { name: 'Войти в комнату' }).click()
      await expect(g.getByText('Вход подтверждает организатор — нужно подождать.')).toBeVisible()
      await expect(page.getByText('Катя просит впустить')).toBeVisible()
      await page.getByRole('button', { name: 'Меню комнаты' }).click()
      await page.getByRole('checkbox', { name: 'Подтверждать вход' }).click()
      await expect(g.getByText('Звук подключён')).toBeVisible()
      await expect(page.getByText('Катя просит впустить')).toHaveCount(0)
    } finally {
      await guest.app.close()
    }
  } finally {
    await host.app.close()
  }
})
