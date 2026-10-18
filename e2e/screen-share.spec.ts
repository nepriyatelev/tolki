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
      await page.getByLabel('Имя').fill('Катя')
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

      const preview = page.getByRole('region', { name: 'Мой экран' }).locator('video')
      await expect(preview).toBeVisible()
      await expect
        .poll(() => preview.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 15_000 })
        .toBeGreaterThan(0)

      // Sent to the room (#27, #34): two streams, ≈1080p in H.264 (or VP8) and ≈360p in VP8,
      // both encoding, tuned for motion.
      const encoded = await expect
        .poll(
          async () => {
            const streams = await sentVideo(page)
            return streams.length === 2 && streams.every((s) => s.framesEncoded > 0)
          },
          { timeout: 20_000 },
        )
        .toBe(true)
        .then(
          () => true,
          () => false,
        )
      const [high, low] = await sentVideo(page)
      console.log('sent video:', JSON.stringify([high, low]))
      expect(encoded).toBe(true)
      expect(high?.codec).toMatch(/^video\/(H264|VP8)$/)
      expect(low?.codec).toBe('video/VP8')
      expect([high?.contentHint, low?.contentHint]).toEqual(['motion', 'motion'])
      expect(low?.frameHeight).toBeLessThanOrEqual(360)
      // Reported, not asserted: CI encodes in software on a tiny virtual screen.
      console.log('cpu while sharing, % of one core:', (await cpuPercent(client.app)).toFixed(1))

      await page.getByRole('button', { name: 'Остановить показ экрана' }).click()
      await expect.poll(async () => (await sentVideo(page)).length).toBe(0)
      await expect(page.getByRole('region', { name: 'Мой экран' })).toHaveCount(0)
    } finally {
      await client.app.close()
    }
  } finally {
    await host.app.close()
  }
})

test('others see the shared screen at a layer that fits, and nothing while hidden', async () => {
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
        await app.page.getByLabel('Имя').fill(name)
        await app.page.getByRole('button', { name: 'Войти в комнату' }).click()
        await expect(app.page.getByRole('heading', { name: 'Кино' })).toBeVisible()
      }

      await katya.page.getByRole('button', { name: 'Показать экран' }).click()
      const dialog = katya.page.getByRole('dialog', { name: 'Что показать' })
      await dialog.getByRole('radio').first().click()
      await dialog.getByRole('button', { name: 'Показать' }).click()

      // The stage shows what arrives: «340p · 15 к/с · 0,4 Мбит/с» (PLAN #30).
      await expect(
        misha.page
          .getByRole('region', { name: 'Экран: Катя' })
          .getByText(/^\d+p · \d+ к\/с · [\d,]+ Мбит\/с$/),
      ).toBeVisible({ timeout: 10_000 })
      // For review: the stage as a viewer sees it (uploaded with test-results on CI).
      await misha.page.screenshot({ path: 'test-results/screen-stage.png' })

      // Misha sees it, big: the ≈1080p stream — once Katya's browser encodes it (a CI runner
      // encoding in software may lag).
      await expect(misha.page.getByRole('region', { name: 'Экран: Катя' })).toBeVisible()
      const highLayerOn = await expect
        .poll(
          async () => {
            const streams = await sentVideo(katya.page)
            return streams.length === 2 && streams.every((s) => s.framesEncoded > 0)
          },
          { timeout: 20_000 },
        )
        .toBe(true)
        .then(
          () => true,
          () => false,
        )
      if (highLayerOn) {
        await expect
          .poll(async () => (await receivedVideo(misha.page))?.frameHeight ?? 0, {
            timeout: 20_000,
          })
          .toBeGreaterThan(600)
      }
      console.log(
        `big window (high layer ${highLayerOn ? 'on' : 'never turned on by the sender'}):`,
        JSON.stringify(await receivedVideo(misha.page)),
      )

      // Shown small: the ≈360p stream is enough, and the organizer switches to it (#34). Even the
      // smallest window shows the stage over 540 device pixels tall on a dense display, and a
      // virtual one may not resize at all, so the stage itself is made small.
      await misha.page.evaluate(() => {
        const video = document.querySelector<HTMLVideoElement>('.screen-stage-video')
        if (video) video.style.height = `${Math.floor(500 / window.devicePixelRatio / 2)}px`
      })
      await expect
        .poll(async () => (await receivedVideo(misha.page))?.frameHeight ?? 0, { timeout: 20_000 })
        .toBeLessThanOrEqual(360)
      // Still the same screen on the stage, still playing.
      await expect(misha.page.getByRole('region', { name: 'Экран: Катя' })).toBeVisible()
      const smallAt = (await receivedVideo(misha.page))?.framesDecoded ?? 0
      await expect
        .poll(async () => (await receivedVideo(misha.page))?.framesDecoded ?? 0, {
          timeout: 10_000,
        })
        .toBeGreaterThan(smallAt)
      console.log('small stage:', JSON.stringify(await receivedVideo(misha.page)))

      // Hidden (minimized): nothing arrives; shown again: frames again. The OS signal itself
      // cannot be produced on a virtual display without a window manager, so the page is told
      // it is hidden the way the browser would; everything after that is real.
      const setHidden = (hidden: boolean) =>
        misha.page.evaluate((h) => {
          Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => (h ? 'hidden' : 'visible'),
          })
          document.dispatchEvent(new Event('visibilitychange'))
        }, hidden)
      await setHidden(true)
      await misha.page.waitForTimeout(1500)
      const pausedAt = (await receivedVideo(misha.page))?.framesDecoded ?? 0
      await misha.page.waitForTimeout(2000)
      expect((await receivedVideo(misha.page))?.framesDecoded ?? 0).toBe(pausedAt)
      await setHidden(false)
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

test('one screen at a time: «Показать свой» goes to the sharer, who gives way', async () => {
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

      for (const [app, name] of [
        [katya, 'Катя'],
        [misha, 'Миша'],
      ] as const) {
        await app.page.getByLabel('Имя').fill(name)
        await app.page.getByRole('button', { name: 'Войти в комнату' }).click()
        await expect(app.page.getByRole('heading', { name: 'Кино' })).toBeVisible()
      }
      const share = async (page: typeof katya.page) => {
        const dialog = page.getByRole('dialog', { name: 'Что показать' })
        await dialog.getByRole('radio').first().click()
        await dialog.getByRole('button', { name: 'Показать' }).click()
      }

      await katya.page.getByRole('button', { name: 'Показать экран' }).click()
      await share(katya.page)
      await expect(misha.page.getByRole('region', { name: 'Экран: Катя' })).toBeVisible()

      // Misha asks; Katya gives way; Misha picks his screen and everyone sees it.
      await misha.page.getByRole('button', { name: 'Попросить показать свой экран' }).click()
      await expect(
        misha.page.getByRole('button', { name: 'Ожидание ответа на запрос показа' }),
      ).toBeDisabled()
      await expect(katya.page.getByText('Миша просит показать свой экран')).toBeVisible()
      await katya.page.getByRole('button', { name: 'Уступить' }).click()
      await expect(katya.page.getByRole('region', { name: 'Мой экран' })).toHaveCount(0)
      await share(misha.page)
      await expect(katya.page.getByRole('region', { name: 'Экран: Миша' })).toBeVisible()
      await expect(misha.page.getByRole('region', { name: 'Экран: Катя' })).toHaveCount(0)
    } finally {
      await misha.app.close()
      await katya.app.close()
    }
  } finally {
    await host.app.close()
  }
})
