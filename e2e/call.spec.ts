import { createServer, type AddressInfo } from 'node:net'
import { expect, test, type Page } from '@playwright/test'
import { launchApp } from './app'

// Chromium's fake capture device plays a beeping tone instead of using a real microphone.
const FAKE_MEDIA = '--use-fake-device-for-media-stream'

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

async function joinByUi(page: Page, name: string): Promise<void> {
  await page.getByLabel('Твоё имя').fill(name)
  await page.getByRole('button', { name: 'Войти в комнату' }).click()
  await expect(page.getByText('Звук подключён')).toBeVisible()
}

/** Loudest level of the remote voice played on this page over a short window (0 = silence). */
function heardLevel(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const audio = document.querySelector('audio[data-peer-id]')
    if (!(audio instanceof HTMLAudioElement) || !(audio.srcObject instanceof MediaStream)) return 0
    const context = new AudioContext()
    const analyser = context.createAnalyser()
    context.createMediaStreamSource(audio.srcObject).connect(analyser)
    const samples = new Float32Array(analyser.fftSize)
    let loudest = 0
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      analyser.getFloatTimeDomainData(samples)
      for (const s of samples) loudest = Math.max(loudest, Math.abs(s))
    }
    await context.close()
    return loudest
  })
}

test('two app instances on one machine hear each other through the host', async () => {
  const host = await launchApp()
  try {
    const port = await freePort()
    const state = await host.page.evaluate(
      (p) =>
        window.ratatosk.host.start({
          port: p,
          portMapping: false,
          roomName: 'Созвон',
          password: '',
        }),
      port,
    )
    if (state.status !== 'running') throw new Error('host did not start')
    const link = `ratatosk://join?v=1&h=127.0.0.1&p=${port}&r=call&fp=${state.fingerprint}`

    const katya = await launchApp({ args: [FAKE_MEDIA, link] })
    try {
      await joinByUi(katya.page, 'Катя')
      const misha = await launchApp({ args: [FAKE_MEDIA, link] })
      try {
        await joinByUi(misha.page, 'Миша')

        // Each one plays the other's voice, and it is not silence.
        for (const page of [katya.page, misha.page]) {
          await expect(page.locator('audio[data-peer-id]')).toHaveCount(1)
          await expect.poll(() => heardLevel(page), { timeout: 15_000 }).toBeGreaterThan(0.01)
        }

        // The fake microphones beep: the speaking frame shows up around someone's tile.
        await expect(misha.page.locator('.call-tile--speaking').first()).toBeVisible({
          timeout: 15_000,
        })

        // Misha leaves: Katya stops playing his voice.
        await misha.page.getByRole('button', { name: 'Выйти' }).click()
        await expect(katya.page.locator('audio[data-peer-id]')).toHaveCount(0)
      } finally {
        await misha.app.close()
      }
    } finally {
      await katya.app.close()
    }
  } finally {
    await host.app.close()
  }
})
