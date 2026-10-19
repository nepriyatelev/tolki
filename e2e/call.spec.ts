import { expect, test, type Page } from '@playwright/test'
import { launchApp, type LaunchedApp } from './app'
import { freePort } from './ports'
import { heardLevel, tapPeerConnections } from './media'

// Chromium's fake capture device plays a beeping tone instead of using a real microphone.
const FAKE_MEDIA = '--use-fake-device-for-media-stream'

async function joinByUi(page: Page, name: string): Promise<void> {
  await page.getByLabel('Имя').fill(name)
  await page.getByRole('button', { name: 'Войти в комнату' }).click()
  await expect(page.getByText('Звук подключён')).toBeVisible()
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
    // The call's own output: cues (#43) make gains of their own, in contexts closed by now.
    const master = (window as unknown as { gains: GainNode[] }).gains.find(
      (gain) => gain.context.state !== 'closed',
    )
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

// One room for the whole file (#81): the organizer's app and two participants are started once,
// then each check is a test of its own. Serial: they share the call, and each one leaves it as
// it found it. Not a worker fixture: with one worker it would keep three apps open through the
// rest of the suite.
test.describe.serial('a call between two app instances through the organizer', () => {
  let katya: LaunchedApp
  let misha: LaunchedApp
  /** Everything started so far, closed in reverse even if the setup stopped halfway. */
  const started: LaunchedApp[] = []
  const launch = async (options?: Parameters<typeof launchApp>[0]): Promise<LaunchedApp> => {
    const app = await launchApp(options)
    started.push(app)
    return app
  }

  test.beforeAll(async () => {
    // Three apps and two joins: past the default 30 s on a slow CI runner.
    test.setTimeout(90_000)
    const host = await launch()
    const port = await freePort()
    const state = await host.page.evaluate(
      (p) =>
        window.tolki.host.start({ port: p, portMapping: false, roomName: 'Созвон', password: '' }),
      port,
    )
    if (state.status !== 'running') throw new Error('host did not start')
    const link = `tolki://join?v=1&h=127.0.0.1&p=${port}&r=call&fp=${state.fingerprint}`
    katya = await launch({ args: [FAKE_MEDIA, link] })
    await tapOutput(katya.page)
    await tapPeerConnections(katya.page)
    await joinByUi(katya.page, 'Катя')
    misha = await launch({ args: [FAKE_MEDIA, link] })
    await joinByUi(misha.page, 'Миша')
  })

  test.afterAll(async () => {
    for (const app of started.reverse()) await app.app.close()
  })

  test('each one plays the other’s voice, and it is not silence', async () => {
    for (const page of [katya.page, misha.page]) {
      await expect(page.locator('audio[data-peer-id]')).toHaveCount(1)
      await expect.poll(() => heardLevel(page), { timeout: 15_000 }).toBeGreaterThan(0.01)
    }
  })

  test('the speaking frame shows up around a talking participant', async () => {
    // The fake microphones beep.
    await expect(misha.page.locator('.call-tile--speaking').first()).toBeVisible({
      timeout: 15_000,
    })
  })

  test('the voice goes out as mono Opus, ~40 kbit/s, DTX and FEC, voice processing on (#25)', async () => {
    await expect.poll(async () => (await sentVoice(katya.page))?.fmtp ?? '').toContain('usedtx=1')
    const voice = await sentVoice(katya.page)
    expect(voice?.fmtp).toContain('useinbandfec=1')
    expect(voice?.fmtp).toContain('maxaveragebitrate=40000')
    expect(voice?.fmtp).toContain('stereo=0')
    expect(voice?.settings).toMatchObject({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    })
  })

  test('a participant’s volume in the «⋯» menu silences them only here, and resets (#23, #77)', async () => {
    test.setTimeout(45_000)
    await expect.poll(() => outputLevel(katya.page), { timeout: 15_000 }).toBeGreaterThan(0.01)
    await katya.page.getByRole('button', { name: 'Меню: Миша' }).click()
    const menu = katya.page.getByRole('dialog', { name: 'Звук: Миша' })
    await menu.getByRole('slider', { name: 'Громкость: Миша' }).fill('0')
    await expect(menu.getByText('0%', { exact: true })).toBeVisible()
    await expect.poll(() => outputLevel(katya.page), { timeout: 15_000 }).toBeLessThan(0.001)
    await menu.getByRole('button', { name: 'Сбросить до 100 %' }).click()
    await katya.page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
  })

  test('switching microphones mid-call keeps the voice going, nobody reconnects (#24)', async () => {
    await katya.page.getByRole('button', { name: 'Настройки' }).click()
    const dialog = katya.page.getByRole('dialog', { name: 'Настройки звука' })
    const mic = dialog.getByLabel('Микрофон', { exact: true })
    await expect.poll(() => mic.locator('option').count()).toBeGreaterThan(2)
    await mic.selectOption({ index: 2 })
    await dialog.getByRole('button', { name: 'Закрыть' }).click()
    await expect(dialog).toBeHidden()
    await expect(misha.page.locator('audio[data-peer-id]')).toHaveCount(1)
    await expect.poll(() => heardLevel(misha.page), { timeout: 15_000 }).toBeGreaterThan(0.01)
  })

  test('Ctrl+Shift+M (⌘⇧M) turns the microphone off: the other one sees it and hears silence (#22, #110)', async () => {
    await katya.page.keyboard.press('ControlOrMeta+Shift+KeyM')
    await expect(katya.page.getByRole('button', { name: 'Включить микрофон' })).toBeVisible()
    await expect(
      misha.page.getByRole('listitem', { name: 'Катя' }).getByRole('img', {
        name: 'Микрофон выключен',
      }),
    ).toBeVisible()
    await expect.poll(() => heardLevel(misha.page), { timeout: 15_000 }).toBeLessThan(0.001)
    // Back as it was for the next test.
    await katya.page.keyboard.press('ControlOrMeta+Shift+KeyM')
    await expect(katya.page.getByRole('button', { name: 'Выключить микрофон' })).toBeVisible()
  })

  test('Ctrl+Shift+D (⌘⇧D) turns the sound off and the microphone with it (#22, #110)', async () => {
    await misha.page.keyboard.press('ControlOrMeta+Shift+KeyD')
    await expect(misha.page.getByRole('button', { name: 'Включить звук' })).toBeVisible()
    await expect(misha.page.getByRole('button', { name: 'Включить микрофон' })).toBeVisible()
    await misha.page.keyboard.press('ControlOrMeta+Shift+KeyD')
    await expect(misha.page.getByRole('button', { name: 'Выключить звук' })).toBeVisible()
  })

  test('when one leaves, the other stops playing their voice', async () => {
    await misha.page.getByRole('button', { name: 'Выйти' }).click()
    await expect(katya.page.locator('audio[data-peer-id]')).toHaveCount(0)
  })
})
