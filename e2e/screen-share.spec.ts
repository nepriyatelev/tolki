import { createServer, type AddressInfo } from 'node:net'
import { expect, test } from '@playwright/test'
import { launchApp } from './app'
import { cpuPercent, receivedVideo, sentVideo, tapPeerConnections } from './media'

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
        window.ratatosk.host.start({
          port: p,
          portMapping: false,
          roomName: 'Кино',
          password: '',
          screenMode: 'motion',
        }),
      port,
    )
    if (state.status !== 'running') throw new Error('host did not start')
    const client = await launchApp({
      args: [`ratatosk://join?v=1&h=127.0.0.1&p=${port}&r=kino&fp=${state.fingerprint}`],
    })
    try {
      const page = client.page
      // Right after start the display may not be listed yet (seen under xvfb): ask a few times.
      let hasScreen = false
      for (let attempt = 0; attempt < 20 && !hasScreen; attempt++) {
        const sources = await page.evaluate(() => window.ratatosk.screen.listSources())
        hasScreen = sources.picker === 'app' && sources.sources.some((s) => s.kind === 'screen')
        if (!hasScreen) await page.waitForTimeout(500)
      }
      // Linux CI has a screen (xvfb) and must run this; a developer's Mac may lack the permission.
      const mustRun = Boolean(process.env['CI']) && process.platform === 'linux'
      if (mustRun) expect(hasScreen).toBe(true)
      test.skip(!hasScreen, 'no screen to capture (no «Запись экрана» permission?)')

      await tapPeerConnections(page)
      await page.getByLabel('Твоё имя').fill('Катя')
      await page.getByRole('button', { name: 'Войти в комнату' }).click()
      await page.getByRole('button', { name: 'Показать экран' }).click()
      const dialog = page.getByRole('dialog', { name: 'Что показать' })
      const firstSource = dialog.getByRole('radio').first()
      // The virtual display is sometimes listed late: refresh once, and say what was shown.
      const listed = await firstSource.waitFor({ timeout: 10_000 }).then(
        () => true,
        () => false,
      )
      if (!listed) {
        console.log('picker before refresh:', await dialog.innerText())
        await dialog.getByRole('button', { name: 'Обновить список' }).click()
      }
      await firstSource.click()
      await dialog.getByRole('button', { name: 'Показать' }).click()

      const preview = page.getByRole('listitem', { name: 'Твой экран' }).locator('video')
      await expect(preview).toBeVisible()
      await expect
        .poll(() => preview.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 15_000 })
        .toBeGreaterThan(0)

      // Sent to the room (#27): two simulcast layers (≈360p and ≈1080p), both encoding,
      // H.264 or VP8, tuned for motion.
      const encoded = await expect
        .poll(
          async () => (await sentVideo(page))?.layers.every((l) => l.framesEncoded > 0) ?? false,
          { timeout: 20_000 },
        )
        .toBe(true)
        .then(
          () => true,
          () => false,
        )
      const video = await sentVideo(page)
      console.log('sent video:', JSON.stringify(video))
      expect(video?.codec).toMatch(/^video\/(H264|VP8)$/)
      expect(video?.contentHint).toBe('motion')
      expect(video?.layers).toHaveLength(2)
      expect(encoded).toBe(true)
      expect(video?.layers.map((l) => l.frameHeight).sort((a, b) => a - b)[0]).toBeLessThanOrEqual(
        360,
      )
      // Reported, not asserted: CI encodes in software on a tiny virtual screen.
      console.log('cpu while sharing, % of one core:', (await cpuPercent(client.app)).toFixed(1))

      await page.getByRole('button', { name: 'Остановить показ экрана' }).click()
      await expect.poll(async () => (await sentVideo(page))?.layers.length ?? 0).toBe(0)
      await expect(page.getByRole('listitem', { name: 'Твой экран' })).toHaveCount(0)
    } finally {
      await client.app.close()
    }
  } finally {
    await host.app.close()
  }
})

test('others see the shared screen at a layer that fits, and nothing while minimized', async () => {
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
    const link = `ratatosk://join?v=1&h=127.0.0.1&p=${port}&r=kino&fp=${state.fingerprint}`
    const katya = await launchApp({ args: [link] })
    const misha = await launchApp({ args: [link] })
    try {
      let hasScreen = false
      for (let attempt = 0; attempt < 20 && !hasScreen; attempt++) {
        const sources = await katya.page.evaluate(() => window.ratatosk.screen.listSources())
        hasScreen = sources.picker === 'app' && sources.sources.some((s) => s.kind === 'screen')
        if (!hasScreen) await katya.page.waitForTimeout(500)
      }
      if (Boolean(process.env['CI']) && process.platform === 'linux') expect(hasScreen).toBe(true)
      test.skip(!hasScreen, 'no screen to capture (no «Запись экрана» permission?)')

      const resize = (width: number, height: number) =>
        misha.app.evaluate(
          ({ BrowserWindow }, size) => {
            BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height)
          },
          { width, height },
        )
      await resize(1280, 1000)
      await tapPeerConnections(misha.page)
      await tapPeerConnections(katya.page)
      for (const [app, name] of [
        [katya, 'Катя'],
        [misha, 'Миша'],
      ] as const) {
        await app.page.getByLabel('Твоё имя').fill(name)
        await app.page.getByRole('button', { name: 'Войти в комнату' }).click()
        await expect(app.page.getByRole('heading', { name: 'Кино' })).toBeVisible()
      }

      await katya.page.getByRole('button', { name: 'Показать экран' }).click()
      const dialog = katya.page.getByRole('dialog', { name: 'Что показать' })
      await dialog.getByRole('radio').first().click()
      await dialog.getByRole('button', { name: 'Показать' }).click()

      // Misha sees it, big: the ≈1080p layer.
      await expect(misha.page.getByRole('listitem', { name: 'Экран: Катя' })).toBeVisible()
      await expect
        .poll(async () => (await receivedVideo(misha.page))?.frameHeight ?? 0, { timeout: 30_000 })
        .toBeGreaterThan(600)
      console.log(
        'big window:',
        JSON.stringify(await receivedVideo(misha.page)),
        JSON.stringify(await sentVideo(katya.page)),
      )

      // A small window: the ≈360p layer is enough.
      await resize(960, 640)
      await expect
        .poll(async () => (await receivedVideo(misha.page))?.frameHeight ?? 0, { timeout: 20_000 })
        .toBeLessThanOrEqual(360)
      console.log('small window:', JSON.stringify(await receivedVideo(misha.page)))

      // Minimized: nothing arrives; restored: frames again.
      await misha.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.minimize()
      })
      await misha.page.waitForTimeout(1500)
      const pausedAt = (await receivedVideo(misha.page))?.framesDecoded ?? 0
      await misha.page.waitForTimeout(2000)
      expect((await receivedVideo(misha.page))?.framesDecoded ?? 0).toBe(pausedAt)
      await misha.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.restore()
      })
      await expect
        .poll(async () => (await receivedVideo(misha.page))?.framesDecoded ?? 0, {
          timeout: 15_000,
        })
        .toBeGreaterThan(pausedAt)
    } finally {
      await misha.app.close()
      await katya.app.close()
    }
  } finally {
    await host.app.close()
  }
})
