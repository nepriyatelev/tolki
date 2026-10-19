import { expect, test } from '@playwright/test'
import { launchApp } from './app'
import { freePort } from './ports'

// PLAN #40: a hotkey set in «Настройки» is registered system-wide only during the call.
// A real key press at the OS level cannot be made from Playwright (its keys go to the page), so
// main's signal is sent the way main sends it, and the registration is checked in main itself.

const FAKE_MEDIA = '--use-fake-device-for-media-stream'
const ACCELERATOR = 'Control+Alt+Shift+F12'

test('a global hotkey is held only during the call and toggles the microphone', async () => {
  test.setTimeout(60_000)
  const host = await launchApp({ args: [FAKE_MEDIA] })
  try {
    const port = await freePort()
    const state = await host.page.evaluate(
      (p) =>
        window.tolki.host.start({ port: p, portMapping: false, roomName: 'Клавиши', password: '' }),
      port,
    )
    if (state.status !== 'running') throw new Error('host did not start')
    const page = host.page
    await page
      .getByLabel('Ссылка-приглашение')
      .fill(`tolki://join?v=1&h=127.0.0.1&p=${port}&r=keys&fp=${state.fingerprint}`)
    await page.getByRole('button', { name: 'Войти', exact: true }).click()
    await page.getByLabel('Имя').fill('Дима')
    await page.getByRole('button', { name: 'Войти в комнату' }).click()
    await expect(page.getByText('Звук подключён')).toBeVisible()
    const registered = () =>
      host.app.evaluate(({ globalShortcut }, a) => globalShortcut.isRegistered(a), ACCELERATOR)
    expect(await registered()).toBe(false)

    await page.getByRole('button', { name: 'Настройки' }).click()
    const dialog = page.getByRole('dialog', { name: 'Настройки' })
    await dialog.getByRole('button', { name: 'Микрофон: не задано' }).click()
    await page.keyboard.press('Control+Alt+Shift+F12')
    await expect(dialog.getByRole('button', { name: 'Микрофон: Ctrl+Alt+Shift+F12' })).toBeVisible()
    await expect.poll(registered).toBe(true)
    await dialog.getByRole('button', { name: 'Закрыть' }).click()

    // Main saw the hotkey while another app had focus.
    await host.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('hotkeys:pressed', { action: 'mute' })
    })
    await expect(page.getByRole('button', { name: 'Включить микрофон' })).toBeVisible()

    // Out of the call, the combination goes back to every other app.
    await page.getByRole('button', { name: 'Выйти' }).click()
    await expect.poll(registered).toBe(false)
  } finally {
    await host.app.close()
  }
})
