import { expect, test } from '@playwright/test'
import { launchApp, launchSecondInstance } from './app'
import { freePort } from './ports'

// PLAN #44: the window's cross hides it — the call goes on; launching Tolki again (or the tray,
// or the Dock) brings it back. Without «Сворачивать в трей», the cross quits (Windows, Linux).

const FAKE_MEDIA = '--use-fake-device-for-media-stream'

test('closing the window hides it; the call goes on; launching again brings it back', async () => {
  test.setTimeout(90_000)
  const host = await launchApp({ args: [FAKE_MEDIA] })
  try {
    const port = await freePort()
    const state = await host.page.evaluate(
      (p) =>
        window.tolki.host.start({ port: p, portMapping: false, roomName: 'Трей', password: '' }),
      port,
    )
    if (state.status !== 'running') throw new Error('host did not start')
    const link = `tolki://join?v=1&h=127.0.0.1&p=${port}&r=tray&fp=${state.fingerprint}`
    await host.page.getByLabel('Ссылка-приглашение').fill(link)
    await host.page.getByRole('button', { name: 'Войти', exact: true }).click()
    await host.page.getByLabel('Имя').fill('Дима')
    await host.page.getByRole('button', { name: 'Войти в комнату' }).click()
    await expect(host.page.getByText('Звук подключён')).toBeVisible()

    const katya = await launchApp({ args: [FAKE_MEDIA, link] })
    try {
      await katya.page.getByLabel('Имя').fill('Катя')
      await katya.page.getByRole('button', { name: 'Войти в комнату' }).click()
      await expect(katya.page.getByText('Звук подключён')).toBeVisible()

      const visible = () =>
        katya.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())
      await katya.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.close()
      })
      await expect.poll(visible).toBe(false)
      // Still in the call: the organizer keeps seeing her.
      await host.page.waitForTimeout(2000)
      await expect(
        host.page.getByRole('list', { name: 'Участники' }).getByRole('listitem'),
      ).toHaveCount(2)

      // Launching Tolki again shows the window that was hidden.
      expect(await launchSecondInstance(katya.userDataDir, [])).toBe(0)
      await expect.poll(visible).toBe(true)
      await expect(katya.page.getByText('Звук подключён')).toBeVisible()
    } finally {
      await katya.app.close()
    }
  } finally {
    await host.app.close()
  }
})

test('without «Сворачивать в трей» the cross quits (Windows, Linux)', async () => {
  test.skip(process.platform === 'darwin', 'macOS keeps the app in the Dock, as Mac apps do')
  const { app, page } = await launchApp()
  await page.evaluate(() => window.tolki.settings.update({ tray: { closeToTray: false } }))
  const exited = new Promise<void>((resolve) => {
    app.process().once('exit', () => {
      resolve()
    })
  })
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close()
  })
  await exited
})
