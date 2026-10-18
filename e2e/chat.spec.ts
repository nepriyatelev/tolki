import { expect, test } from '@playwright/test'
import { launchApp } from './app'
import { freePort } from './ports'

// PLAN #45: a mini chat for the call — text and links, nothing kept. Whoever comes later sees
// none of the earlier messages.

const FAKE_MEDIA = '--use-fake-device-for-media-stream'

test('messages reach everyone in the call; a newcomer sees none of the earlier ones', async () => {
  test.setTimeout(60_000)
  const host = await launchApp()
  try {
    const port = await freePort()
    const state = await host.page.evaluate(
      (p) =>
        window.tolki.host.start({ port: p, portMapping: false, roomName: 'Чат', password: '' }),
      port,
    )
    if (state.status !== 'running') throw new Error('host did not start')
    const link = `tolki://join?v=1&h=127.0.0.1&p=${port}&r=chat&fp=${state.fingerprint}`
    const join = async (name: string) => {
      const app = await launchApp({ args: [FAKE_MEDIA, link] })
      await app.page.getByLabel('Имя').fill(name)
      await app.page.getByRole('button', { name: 'Войти в комнату' }).click()
      await expect(app.page.getByText('Звук подключён')).toBeVisible()
      return app
    }
    const katya = await join('Катя')
    const misha = await join('Миша')
    try {
      await katya.page.getByRole('button', { name: 'Чат' }).click()
      await katya.page
        .getByRole('textbox', { name: 'Сообщение' })
        .fill('Презентация: https://example.com/slides')
      await katya.page.getByRole('textbox', { name: 'Сообщение' }).press('Enter')
      const katyaChat = katya.page.getByRole('complementary', { name: 'Чат' })
      await expect(
        katyaChat.getByRole('link', { name: 'https://example.com/slides' }),
      ).toBeVisible()

      // Misha has the chat closed: the button counts the message.
      await misha.page.getByRole('button', { name: 'Чат, новых сообщений: 1' }).click()
      const mishaChat = misha.page.getByRole('complementary', { name: 'Чат' })
      await expect(mishaChat.getByText('Катя')).toBeVisible()
      await expect(
        mishaChat.getByRole('link', { name: 'https://example.com/slides' }),
      ).toBeVisible()
      await misha.page.getByRole('textbox', { name: 'Сообщение' }).fill('Вижу')
      await misha.page.getByRole('button', { name: 'Отправить' }).click()
      await expect(katyaChat.getByText('Вижу')).toBeVisible()
      await misha.page.screenshot({ path: test.info().outputPath('chat.png') })

      const olya = await join('Оля')
      try {
        await olya.page.getByRole('button', { name: 'Чат' }).click()
        await expect(
          olya.page.getByText('Сообщения видны только участникам этого звонка и не сохраняются.'),
        ).toBeVisible()
      } finally {
        await olya.app.close()
      }
    } finally {
      await misha.app.close()
      await katya.app.close()
    }
  } finally {
    await host.app.close()
  }
})
