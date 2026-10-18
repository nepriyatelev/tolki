import { expect, test } from '@playwright/test'
import { freePort } from './ports'
import { launchApp } from './app'

// Chromium's fake capture device plays a beeping tone instead of using a real microphone.
const FAKE_MEDIA = '--use-fake-device-for-media-stream'

test('the organizer opens a room from the UI and is in its call; leaving closes it (#100)', async () => {
  test.setTimeout(90_000)
  const host = await launchApp({ args: [FAKE_MEDIA] })
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
    await page.getByLabel('Имя').fill('Дима')
    await page.getByRole('button', { name: 'Сгенерировать' }).click()
    const password = await page.getByLabel('Пароль', { exact: true }).inputValue()
    expect(password).toMatch(/^[а-яё]+-[а-яё]+-\d{2}$/)
    await page.getByText('Дополнительно').click()
    await page.getByLabel('Порт').fill(String(port))
    await page.getByLabel('Порт').blur()

    await page.getByRole('button', { name: 'Открыть комнату' }).click()
    // Straight into the call of the room, microphone on.
    await expect(page.getByRole('heading', { name: 'Вечерний созвон' })).toBeVisible()
    await expect(page.getByText('Звук подключён')).toBeVisible()
    // No public link in e2e (the router is not touched), so nothing to invite with.
    await expect(page.getByRole('button', { name: 'Пригласить' })).toHaveCount(0)

    const state = await page.evaluate(() => window.tolki.host.getState())
    expect(state).toMatchObject({ status: 'running', port })
    const fingerprint = await page.evaluate(() => window.tolki.host.getFingerprint())
    expect(state.status === 'running' && state.fingerprint).toBe(fingerprint)

    // A participant joins with the room's password; the organizer is already inside.
    const friend = await launchApp({
      args: [FAKE_MEDIA, `tolki://join?v=1&h=127.0.0.1&p=${port}&r=room&fp=${fingerprint}`],
    })
    try {
      await friend.page.getByLabel('Имя').fill('Катя')
      await friend.page.getByLabel('Пароль комнаты').fill(password)
      await friend.page.getByRole('button', { name: 'Войти в комнату' }).click()
      await expect(friend.page.getByRole('heading', { name: 'Вечерний созвон' })).toBeVisible()
      await expect(
        friend.page.getByRole('list', { name: 'Участники' }).getByRole('listitem'),
      ).toHaveCount(2)
      // They hear each other: each plays the other's voice.
      await expect(friend.page.locator('audio[data-peer-id]')).toHaveCount(1, { timeout: 15_000 })
      await expect(page.locator('audio[data-peer-id]')).toHaveCount(1, { timeout: 15_000 })

      // The organizer leaves: the room closes for everyone.
      await page.getByRole('button', { name: 'Выйти' }).click()
      await expect(friend.page.getByText('Организатор закрыл комнату')).toBeVisible({
        timeout: 15_000,
      })
      await expect(page.getByRole('button', { name: 'Создать комнату' })).toBeVisible()
      await expect
        .poll(() => page.evaluate(() => window.tolki.host.getState()))
        .toEqual({ status: 'stopped' })
    } finally {
      await friend.app.close()
    }
  } finally {
    await host.app.close()
  }
})
