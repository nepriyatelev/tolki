import { expect, test } from '@playwright/test'
import { freePort } from './ports'
import { launchApp } from './app'

// Chromium's fake capture device plays a tone instead of using a real microphone.
const FAKE_MEDIA = '--use-fake-device-for-media-stream'

test('the join screen previews the room, checks the microphone and joins muted', async () => {
  const host = await launchApp()
  const port = await freePort()
  const state = await host.page.evaluate(
    (p) =>
      window.tolki.host.start({
        port: p,
        portMapping: false,
        roomName: 'Кино по пятницам',
        password: 'secret',
      }),
    port,
  )
  if (state.status !== 'running') throw new Error('host did not start')
  const fingerprint = state.fingerprint
  // Someone is already inside, so the preview has a count to show.
  await host.page.evaluate(
    ({ p, fp }) =>
      window.tolki.room.join({
        invite: { host: '127.0.0.1', hostKind: 'ipv4', port: p, roomId: 'kino', fingerprint: fp },
        name: 'Дима',
        password: 'secret',
      }),
    { p: port, fp: fingerprint },
  )

  const client = await launchApp({
    args: [FAKE_MEDIA, `tolki://join?v=1&h=127.0.0.1&p=${port}&r=kino&fp=${fingerprint}`],
  })
  const page = client.page
  try {
    // Preview before joining: name and count only.
    await expect(page.getByRole('heading', { name: 'Кино по пятницам' })).toBeVisible()
    await expect(page.getByText('В комнате 1 человек')).toBeVisible()
    await expect(page.getByText('Дима')).toHaveCount(0)
    await expect(
      page.getByText('Подключение напрямую к организатору · сертификат совпадает со ссылкой'),
    ).toBeVisible()

    // The microphone meter moves with the fake device's tone.
    const meter = page.getByRole('meter', { name: 'Уровень микрофона' })
    await expect
      .poll(async () => Number(await meter.getAttribute('aria-valuenow')))
      .toBeGreaterThan(0)
    const options = page.getByLabel('Микрофон', { exact: true }).locator('option')
    await expect.poll(() => options.count()).toBeGreaterThan(1)
    const device = await options.nth(1).getAttribute('value')
    await page.getByLabel('Микрофон', { exact: true }).selectOption(device ?? '')
    await expect
      .poll(() =>
        page.evaluate(() => window.tolki.settings.get().then((s) => s.audio.inputDeviceId)),
      )
      .toBe(device)

    await page.getByLabel('Имя').fill('Катя')
    await page.getByLabel('Пароль комнаты').fill('secret')
    await page.getByRole('checkbox', { name: 'Войти с выключенным микрофоном' }).check()
    await page.getByRole('button', { name: 'Войти в комнату' }).click()
    await expect(page.getByRole('heading', { name: 'Кино по пятницам' })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Участники' }).getByRole('listitem')).toHaveCount(2)
    await expect(page.getByRole('img', { name: 'Микрофон выключен' })).toBeVisible()
  } finally {
    await client.app.close()
    await host.app.close()
  }
})

test('only the microphone is allowed: the camera stays denied', async () => {
  const { app, page } = await launchApp({ args: [FAKE_MEDIA] })
  try {
    const result = await page.evaluate(async () => {
      const outcome = async (constraints: MediaStreamConstraints) => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia(constraints)
          for (const track of stream.getTracks()) track.stop()
          return 'granted'
        } catch (error) {
          return (error as DOMException).name
        }
      }
      return { audio: await outcome({ audio: true }), video: await outcome({ video: true }) }
    })

    expect(result).toEqual({ audio: 'granted', video: 'NotAllowedError' })
  } finally {
    await app.close()
  }
})
