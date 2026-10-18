import { createServer, type AddressInfo } from 'node:net'
import { expect, test, type Page } from '@playwright/test'
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

/** Starts a room in a host app and returns an invite link for 127.0.0.1. */
async function startRoom(host: Page, password: string): Promise<string> {
  const port = await freePort()
  const state = await host.evaluate(
    ({ p, pw }) =>
      window.ratatosk.host.start({ port: p, portMapping: false, roomName: 'Тест', password: pw }),
    { p: port, pw: password },
  )
  if (state.status !== 'running') throw new Error(`host did not start: ${JSON.stringify(state)}`)
  return `ratatosk://join?v=1&h=127.0.0.1&p=${port}&r=test&fp=${state.fingerprint}`
}

async function tryJoin(page: Page, password: string): Promise<void> {
  await page.getByLabel('Пароль комнаты').fill(password)
  await page.getByRole('button', { name: 'Войти в комнату' }).click()
  await expect(page.getByRole('button', { name: 'Войти в комнату' })).toBeEnabled()
}

test('a wrong password is reported, the right one lets the user in', async () => {
  const host = await launchApp()
  try {
    const link = await startRoom(host.page, 'лиса-маяк-42')
    const client = await launchApp({ args: [link] })
    try {
      const page = client.page
      await page.getByLabel('Имя').fill('Алексей')

      await tryJoin(page, 'не тот')
      await expect(page.getByText('Неверный пароль')).toBeVisible()

      await page.getByLabel('Пароль комнаты').fill('лиса-маяк-42')
      await page.getByRole('button', { name: 'Войти в комнату' }).click()
      await expect(page.getByRole('heading', { name: 'Тест' })).toBeVisible()
      await expect(page.getByRole('list', { name: 'Участники' }).getByRole('listitem')).toHaveCount(
        1,
      )
    } finally {
      await client.app.close()
    }
  } finally {
    await host.app.close()
  }
})

test('after 5 wrong passwords the user gets the «Неверный пароль» screen and waits', async () => {
  const host = await launchApp()
  try {
    const link = await startRoom(host.page, 'secret')
    const client = await launchApp({ args: [link] })
    try {
      const page = client.page
      await page.getByLabel('Имя').fill('Миша')
      for (let i = 0; i < 5; i++) {
        await tryJoin(page, `guess-${i}`)
        await expect(page.getByText('Неверный пароль')).toBeVisible()
      }

      await page.getByLabel('Пароль комнаты').fill('secret')
      await page.getByRole('button', { name: 'Войти в комнату' }).click()

      await expect(page.getByRole('heading', { name: 'Неверный пароль' })).toBeVisible()
      await expect(page.getByText('Слишком много неверных попыток', { exact: false })).toBeVisible()
      await expect(
        page.getByRole('button', { name: /Попробовать снова через \d+ с/ }),
      ).toBeDisabled()
    } finally {
      await client.app.close()
    }
  } finally {
    await host.app.close()
  }
})
