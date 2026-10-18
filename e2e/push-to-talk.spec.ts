import { expect, test } from '@playwright/test'
import { launchApp } from './app'
import { heardLevel } from './media'
import { freePort } from './ports'

// PLAN #39: with push-to-talk on, the voice goes out only while the key is held. e2e keeps the
// key to the focused window (TOLKI_GLOBAL_KEYS=off): no hook on the real keyboard.

const FAKE_MEDIA = '--use-fake-device-for-media-stream'

test('push-to-talk: heard only while the key is held', async () => {
  test.setTimeout(90_000)
  const host = await launchApp()
  try {
    const port = await freePort()
    const state = await host.page.evaluate(
      (p) =>
        window.tolki.host.start({ port: p, portMapping: false, roomName: 'PTT', password: '' }),
      port,
    )
    if (state.status !== 'running') throw new Error('host did not start')
    const link = `tolki://join?v=1&h=127.0.0.1&p=${port}&r=ptt&fp=${state.fingerprint}`
    const katya = await launchApp({ args: [FAKE_MEDIA, link] })
    const misha = await launchApp({ args: [FAKE_MEDIA, link] })
    try {
      for (const [app, name] of [
        [katya, 'Катя'],
        [misha, 'Миша'],
      ] as const) {
        await app.page.getByLabel('Имя').fill(name)
        await app.page.getByRole('button', { name: 'Войти в комнату' }).click()
        await expect(app.page.getByText('Звук подключён')).toBeVisible()
      }
      await expect(misha.page.locator('audio[data-peer-id]')).toHaveCount(1, { timeout: 15_000 })
      await expect.poll(() => heardLevel(misha.page), { timeout: 15_000 }).toBeGreaterThan(0.01)

      // Katya turns it on in «Настройки звука» and picks V.
      await katya.page.getByRole('button', { name: 'Настройки' }).click()
      const dialog = katya.page.getByRole('dialog', { name: 'Настройки звука' })
      await dialog.getByText('Говорить, только пока нажата клавиша').click()
      await expect(dialog.getByText('Работает, только когда окно Tolki активно.')).toBeVisible()
      await dialog.getByRole('button', { name: 'Клавиша для разговора: Ё (`)' }).click()
      await katya.page.keyboard.press('KeyV')
      await expect(dialog.getByRole('button', { name: 'Клавиша для разговора: V' })).toBeVisible()
      await dialog.getByRole('button', { name: 'Закрыть' }).click()
      await expect(katya.page.getByRole('button', { name: 'Микрофон по клавише V' })).toBeVisible()

      // Silent without the key; heard while it is held; silent again on release.
      await expect.poll(() => heardLevel(misha.page), { timeout: 15_000 }).toBeLessThan(0.001)
      await katya.page.keyboard.down('KeyV')
      await expect(katya.page.getByRole('button', { name: 'Микрофон по клавише V' })).toContainText(
        'Говорите',
      )
      await expect.poll(() => heardLevel(misha.page), { timeout: 15_000 }).toBeGreaterThan(0.01)
      await katya.page.keyboard.up('KeyV')
      await expect.poll(() => heardLevel(misha.page), { timeout: 15_000 }).toBeLessThan(0.001)
      // Others do not see «микрофон выключен» flicker: only the key decides, locally.
      await expect(
        misha.page.getByRole('listitem', { name: 'Катя' }).getByRole('img', {
          name: 'Микрофон выключен',
        }),
      ).toHaveCount(0)
    } finally {
      await misha.app.close()
      await katya.app.close()
    }
  } finally {
    await host.app.close()
  }
})
