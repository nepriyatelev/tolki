import { expect, test } from '@playwright/test'
import { firstScreen, launchApp } from './app'
import { heardLevel } from './media'
import { freePort } from './ports'

// PLAN #41: the computer's sound goes along with a shared screen. There is no system loopback
// on a CI runner, so TOLKI_SYSTEM_AUDIO=fake hands over a hidden window's steady tone in its
// place; everything after main (capture, sending, the host, playing) is the real thing.

const FAKE_MEDIA = '--use-fake-device-for-media-stream'

test('the computer’s sound goes with the screen and stops with it', async () => {
  test.setTimeout(90_000)
  const host = await launchApp()
  try {
    const port = await freePort()
    const state = await host.page.evaluate(
      (p) =>
        window.tolki.host.start({ port: p, portMapping: false, roomName: 'Кино', password: '' }),
      port,
    )
    if (state.status !== 'running') throw new Error('host did not start')
    const link = `tolki://join?v=1&h=127.0.0.1&p=${port}&r=kino&fp=${state.fingerprint}`
    const katya = await launchApp({
      args: [FAKE_MEDIA, link],
      env: { TOLKI_SYSTEM_AUDIO: 'fake' },
    })
    const misha = await launchApp({ args: [FAKE_MEDIA, link] })
    try {
      // As in screen-share.spec: right after start the display may not be listed yet (xvfb);
      // a developer's Mac may lack «Запись экрана» for the app run from a terminal.
      let hasScreen = false
      for (let attempt = 0; attempt < 20 && !hasScreen; attempt++) {
        const sources = await katya.page.evaluate(() => window.tolki.screen.listSources())
        hasScreen = sources.picker === 'app' && sources.sources.some((s) => s.kind === 'screen')
        if (!hasScreen) await katya.page.waitForTimeout(500)
      }
      if (Boolean(process.env['CI']) && process.platform === 'linux') expect(hasScreen).toBe(true)
      test.skip(!hasScreen, 'no screen to capture (no «Запись экрана» permission?)')

      for (const [app, name] of [
        [katya, 'Катя'],
        [misha, 'Миша'],
      ] as const) {
        await app.page.getByLabel('Имя').fill(name)
        await app.page.getByRole('button', { name: 'Войти в комнату' }).click()
        await expect(app.page.getByText('Звук подключён')).toBeVisible()
      }

      await katya.page.getByRole('button', { name: 'Показать экран' }).click()
      const dialog = katya.page.getByRole('dialog', { name: 'Что показать' })
      const first = firstScreen(dialog)
      await expect(first).toBeVisible({ timeout: 15_000 })
      await dialog.getByText('Звук компьютера').click()
      await first.click()
      await dialog.getByRole('button', { name: 'Показать' }).click()

      // Misha gets a stream of its own for it, and it is not silence.
      const screenAudio = misha.page.locator('audio[data-screen-audio]')
      await expect(screenAudio).toHaveCount(1, { timeout: 20_000 })
      await expect
        .poll(() => heardLevel(misha.page, 'audio[data-screen-audio]'), { timeout: 15_000 })
        .toBeGreaterThan(0.01)

      await katya.page.getByRole('button', { name: 'Остановить показ экрана' }).click()
      await expect(screenAudio).toHaveCount(0, { timeout: 10_000 })
    } finally {
      await misha.app.close()
      await katya.app.close()
    }
  } finally {
    await host.app.close()
  }
})
