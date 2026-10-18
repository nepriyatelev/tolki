import { expect, test } from '@playwright/test'
import { launchApp } from './app'
import { freePort } from './ports'

// PLAN #43: a short cue when someone comes and when they leave. The cue is synthesized, so the
// test records the notes the app plays.

const FAKE_MEDIA = '--use-fake-device-for-media-stream'

test('a cue when someone comes in and when they leave', async () => {
  test.setTimeout(60_000)
  const host = await launchApp()
  try {
    const port = await freePort()
    const state = await host.page.evaluate(
      (p) =>
        window.tolki.host.start({ port: p, portMapping: false, roomName: 'Звуки', password: '' }),
      port,
    )
    if (state.status !== 'running') throw new Error('host did not start')
    const link = `tolki://join?v=1&h=127.0.0.1&p=${port}&r=cues&fp=${state.fingerprint}`
    const katya = await launchApp({ args: [FAKE_MEDIA, link] })
    try {
      // Every oscillator the app creates, and the note it is set to when it starts.
      await katya.page.evaluate(() => {
        const notes: number[] = []
        Object.assign(window, { notes })
        const create = Object.getOwnPropertyDescriptor(
          BaseAudioContext.prototype,
          'createOscillator',
        )?.value as (this: BaseAudioContext) => OscillatorNode
        BaseAudioContext.prototype.createOscillator = function (this: BaseAudioContext) {
          const tone = create.call(this)
          const start = tone.start.bind(tone)
          tone.start = (when?: number) => {
            notes.push(Math.round(tone.frequency.value))
            start(when)
          }
          return tone
        }
      })
      await katya.page.getByLabel('Имя').fill('Катя')
      await katya.page.getByRole('button', { name: 'Войти в комнату' }).click()
      await expect(katya.page.getByText('Звук подключён')).toBeVisible()
      const notes = () =>
        katya.page.evaluate(() => (window as unknown as { notes: number[] }).notes)
      expect(await notes()).toEqual([])

      const misha = await launchApp({ args: [FAKE_MEDIA, link] })
      await misha.page.getByLabel('Имя').fill('Миша')
      await misha.page.getByRole('button', { name: 'Войти в комнату' }).click()
      await expect.poll(notes).toEqual([523, 784])
      // Cues close together are merged into one, so leave after a moment, as people do.
      await expect(misha.page.getByText('Звук подключён')).toBeVisible()
      await misha.page.waitForTimeout(500)

      await misha.page.getByRole('button', { name: 'Выйти' }).click()
      await expect.poll(notes).toEqual([523, 784, 784, 523])
      await misha.app.close()
    } finally {
      await katya.app.close()
    }
  } finally {
    await host.app.close()
  }
})
