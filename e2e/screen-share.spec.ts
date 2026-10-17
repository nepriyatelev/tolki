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

test('getDisplayMedia gets nothing unless the user picked a source in our dialog', async () => {
  const { app, page } = await launchApp()
  try {
    const error = await page.evaluate(() =>
      navigator.mediaDevices.getDisplayMedia({ video: true }).then(
        () => 'granted',
        (e: unknown) => (e instanceof DOMException ? e.name : String(e)),
      ),
    )
    expect(error).not.toBe('granted')
    // A source that was never listed cannot be selected either.
    expect(await page.evaluate(() => window.ratatosk.screen.select('screen:0:0'))).toBe(false)
  } finally {
    await app.close()
  }
})

test('the user picks a screen and sees what they are showing', async () => {
  test.setTimeout(60_000)
  const host = await launchApp()
  try {
    const port = await freePort()
    const state = await host.page.evaluate(
      (p) =>
        window.ratatosk.host.start({ port: p, portMapping: false, roomName: 'Кино', password: '' }),
      port,
    )
    if (state.status !== 'running') throw new Error('host did not start')
    const client = await launchApp({
      args: [`ratatosk://join?v=1&h=127.0.0.1&p=${port}&r=kino&fp=${state.fingerprint}`],
    })
    try {
      const page = client.page
      const sources = await page.evaluate(() => window.ratatosk.screen.listSources())
      console.log(
        'screen sources:',
        JSON.stringify(sources, (key, value: unknown) =>
          key === 'thumbnail' || key === 'icon' ? typeof value : value,
        ),
      )
      test.skip(
        sources.picker !== 'app' || !sources.sources.some((s) => s.kind === 'screen'),
        `no screen to capture here (${sources.picker})`,
      )

      await page.getByLabel('Твоё имя').fill('Катя')
      await page.getByRole('button', { name: 'Войти в комнату' }).click()
      await page.getByRole('button', { name: 'Показать экран' }).click()
      const dialog = page.getByRole('dialog', { name: 'Что показать' })
      await dialog.getByRole('radio').first().click()
      await dialog.getByRole('button', { name: 'Показать' }).click()

      const preview = page.getByRole('listitem', { name: 'Твой экран' }).locator('video')
      await expect(preview).toBeVisible()
      await expect
        .poll(() => preview.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 15_000 })
        .toBeGreaterThan(0)

      await page.getByRole('button', { name: 'Остановить показ экрана' }).click()
      await expect(page.getByRole('listitem', { name: 'Твой экран' })).toHaveCount(0)
    } finally {
      await client.app.close()
    }
  } finally {
    await host.app.close()
  }
})
