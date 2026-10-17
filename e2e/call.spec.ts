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

/** Records the app's gain nodes, so the test can listen to what actually reaches the speakers. */
function tapOutput(page: Page): Promise<void> {
  return page.evaluate(() => {
    const prototype = AudioContext.prototype
    const createGain = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'createGain')
      ?.value as (this: BaseAudioContext) => GainNode
    const gains: GainNode[] = []
    Object.assign(window, { gains })
    prototype.createGain = function (this: AudioContext) {
      const node = createGain.call(this)
      gains.push(node)
      return node
    }
  })
}

/** Loudest level at the app's output (after the volume and the deafen gain). */
function outputLevel(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const master = (window as unknown as { gains: GainNode[] }).gains[0]
    if (!master) return 0
    const analyser = master.context.createAnalyser()
    master.connect(analyser)
    const samples = new Float32Array(analyser.fftSize)
    let loudest = 0
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      analyser.getFloatTimeDomainData(samples)
      for (const s of samples) loudest = Math.max(loudest, Math.abs(s))
    }
    master.disconnect(analyser)
    return loudest
  })
}

/** Records the app's peer connections, to read what is actually negotiated and sent. */
function tapPeerConnections(page: Page): Promise<void> {
  return page.evaluate(() => {
    const connections: RTCPeerConnection[] = []
    Object.assign(window, { connections })
    const Original = window.RTCPeerConnection
    window.RTCPeerConnection = class extends Original {
      constructor(config?: RTCConfiguration) {
        super(config)
        connections.push(this)
      }
    }
  })
}

/** The sent voice: negotiated Opus parameters and the microphone's processing settings. */
function sentVoice(page: Page): Promise<{ fmtp: string; settings: MediaTrackSettings } | null> {
  return page.evaluate(async () => {
    const { connections } = window as unknown as { connections: RTCPeerConnection[] }
    for (const pc of connections) {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'audio')
      if (!sender?.track) continue
      const stats = [...(await sender.getStats()).values()] as {
        type: string
        sdpFmtpLine?: string
      }[]
      const codec = stats.find((s) => s.type === 'codec')
      return { fmtp: codec?.sdpFmtpLine ?? '', settings: sender.track.getSettings() }
    }
    return null
  })
}

test('two app instances on one machine hear each other through the host', async () => {
  // Three apps and a whole call scenario: well past the default 30 s on a slow CI runner.
  test.setTimeout(120_000)
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
      await tapOutput(katya.page)
      await tapPeerConnections(katya.page)
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

        // The voice goes out as mono Opus, ~40 kbit/s, DTX and FEC, voice processing on (#25).
        await expect
          .poll(async () => (await sentVoice(katya.page))?.fmtp ?? '')
          .toContain('usedtx=1')
        const voice = await sentVoice(katya.page)
        expect(voice?.fmtp).toContain('useinbandfec=1')
        expect(voice?.fmtp).toContain('maxaveragebitrate=40000')
        expect(voice?.fmtp).toContain('stereo=0')
        expect(voice?.settings).toMatchObject({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        })

        // Katya's speakers get Misha's voice; at 0 % they go quiet (PLAN #23).
        await expect.poll(() => outputLevel(katya.page), { timeout: 15_000 }).toBeGreaterThan(0.01)
        const volume = katya.page.getByRole('slider', { name: 'Громкость: Миша' })
        await volume.fill('0')
        await expect(katya.page.getByText('0%', { exact: true })).toBeVisible()
        await expect.poll(() => outputLevel(katya.page), { timeout: 15_000 }).toBeLessThan(0.001)
        await volume.fill('100')

        // Katya switches microphones mid-call: Misha keeps hearing her, nobody reconnects (#24).
        await katya.page.getByRole('button', { name: 'Настройки' }).click()
        const dialog = katya.page.getByRole('dialog', { name: 'Настройки звука' })
        const mic = dialog.getByLabel('Микрофон', { exact: true })
        await expect.poll(() => mic.locator('option').count()).toBeGreaterThan(2)
        await mic.selectOption({ index: 2 })
        await dialog.getByRole('button', { name: 'Закрыть' }).click()
        await expect(dialog).toBeHidden()
        await expect(misha.page.locator('audio[data-peer-id]')).toHaveCount(1)
        await expect.poll(() => heardLevel(misha.page), { timeout: 15_000 }).toBeGreaterThan(0.01)

        // Katya presses M: Misha sees her microphone is off and hears silence.
        await katya.page.keyboard.press('m')
        await expect(katya.page.getByRole('button', { name: 'Включить микрофон' })).toBeVisible()
        await expect(
          misha.page.getByRole('listitem', { name: 'Катя' }).getByRole('img', {
            name: 'Микрофон выключен',
          }),
        ).toBeVisible()
        await expect.poll(() => heardLevel(misha.page), { timeout: 15_000 }).toBeLessThan(0.001)

        // Misha presses D: the sound is off and so is his microphone.
        await misha.page.keyboard.press('d')
        await expect(misha.page.getByRole('button', { name: 'Включить звук' })).toBeVisible()
        await expect(misha.page.getByRole('button', { name: 'Включить микрофон' })).toBeVisible()

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
