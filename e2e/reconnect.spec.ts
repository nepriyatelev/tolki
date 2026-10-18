import { expect, test, type Page } from '@playwright/test'
import { freePort } from './ports'
import { launchApp } from './app'

// Chromium's fake capture device plays a beeping tone instead of using a real microphone.
const FAKE_MEDIA = '--use-fake-device-for-media-stream'

async function join(page: Page, name: string): Promise<void> {
  await page.getByLabel('Имя', { exact: true }).fill(name)
  await page.getByRole('button', { name: 'Войти в комнату' }).click()
  await expect(page.getByText('Звук подключён')).toBeVisible()
}

test('a dropped link comes back by itself: «Переподключение…», then the call goes on', async () => {
  test.setTimeout(120_000)
  const host = await launchApp()
  try {
    const port = await freePort()
    const start = () =>
      host.page.evaluate(
        (p) =>
          window.ratatosk.host.start({
            port: p,
            portMapping: false,
            roomName: 'Кино',
            password: '',
          }),
        port,
      )
    const state = await start()
    if (state.status !== 'running') throw new Error('host did not start')
    const link = `ratatosk://join?v=1&h=127.0.0.1&p=${port}&r=kino&fp=${state.fingerprint}`
    const katya = await launchApp({ args: [FAKE_MEDIA, link] })
    const misha = await launchApp({ args: [FAKE_MEDIA, link] })
    try {
      await join(katya.page, 'Катя')
      await join(misha.page, 'Миша')
      await expect(misha.page.locator('audio[data-peer-id]')).toHaveCount(1)
      // The header tells how the link is (PLAN #32). On one machine Chromium has no loopback UDP
      // candidate, so media takes the ICE-TCP fallback; over a network it is UDP.
      await expect(misha.page.getByText(/^\d+ мс · через организатора \((UDP|TCP)\)$/)).toBeVisible(
        { timeout: 10_000 },
      )

      // The organizer's room server dies without a word (crash, sleep, network gone)…
      const pid = await host.app.evaluate(
        ({ app }) =>
          app.getAppMetrics().find((m) => m.type === 'Utility' && m.name === 'Ratatosk Host')?.pid,
      )
      if (pid === undefined) throw new Error('no host process')
      process.kill(pid, 'SIGKILL')
      for (const app of [katya, misha]) {
        await expect(app.page.getByText('Переподключение…')).toBeVisible({ timeout: 15_000 })
        await expect(app.page.getByText('Нет связи', { exact: true })).toBeVisible()
      }

      // …and is back a few seconds later on the same port, with the same certificate.
      await host.page.waitForTimeout(2000)
      expect((await start()).status).toBe('running')

      for (const app of [katya, misha]) {
        await expect(app.page.getByText('Переподключение…')).toHaveCount(0, { timeout: 30_000 })
        await expect(app.page.getByText('Звук подключён')).toBeVisible()
        await expect(
          app.page.getByRole('list', { name: 'Участники' }).getByRole('listitem'),
        ).toHaveCount(2)
      }
      // Voices flow again.
      await expect(misha.page.locator('audio[data-peer-id]')).toHaveCount(1, { timeout: 15_000 })
      await expect(katya.page.locator('audio[data-peer-id]')).toHaveCount(1, { timeout: 15_000 })
    } finally {
      await misha.app.close()
      await katya.app.close()
    }
  } finally {
    await host.app.close()
  }
})

test('after 30 s without the room: «Связь с комнатой потеряна» with «Попробовать снова»', async () => {
  test.setTimeout(120_000)
  const host = await launchApp()
  try {
    const port = await freePort()
    const state = await host.page.evaluate(
      (p) =>
        window.ratatosk.host.start({ port: p, portMapping: false, roomName: 'Кино', password: '' }),
      port,
    )
    if (state.status !== 'running') throw new Error('host did not start')
    const katya = await launchApp({
      args: [`ratatosk://join?v=1&h=127.0.0.1&p=${port}&r=kino&fp=${state.fingerprint}`],
    })
    try {
      await katya.page.getByLabel('Имя', { exact: true }).fill('Катя')
      await katya.page.getByRole('button', { name: 'Войти в комнату' }).click()
      await expect(katya.page.getByRole('heading', { name: 'Кино' })).toBeVisible()

      const pid = await host.app.evaluate(
        ({ app }) =>
          app.getAppMetrics().find((m) => m.type === 'Utility' && m.name === 'Ratatosk Host')?.pid,
      )
      if (pid === undefined) throw new Error('no host process')
      process.kill(pid, 'SIGKILL')

      await expect(
        katya.page.getByRole('heading', { name: 'Связь с комнатой потеряна' }),
      ).toBeVisible({ timeout: 45_000 })
      await katya.page.getByRole('button', { name: 'Попробовать снова' }).click()
      await expect(katya.page.getByRole('button', { name: 'Войти в комнату' })).toBeVisible()
    } finally {
      await katya.app.close()
    }
  } finally {
    await host.app.close()
  }
})
