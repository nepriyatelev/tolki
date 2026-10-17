import { createServer, type AddressInfo } from 'node:net'
import { expect, test } from '@playwright/test'
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

const FINGERPRINT = '2_SqXt3l45Ay59VWqBcvcLmeh7BmqvL0m-UwbNw3EiE'

test('joining a room nobody hosts shows «Хост не в сети»', async () => {
  const port = await freePort()
  const { app, page } = await launchApp({
    args: [`ratatosk://join?v=1&h=127.0.0.1&p=${port}&r=gone&fp=${FINGERPRINT}`],
  })
  try {
    await page.getByLabel('Твоё имя').fill('Миша')
    await page.getByRole('button', { name: 'Войти в комнату' }).click()

    await expect(page.getByRole('heading', { name: 'Хост не в сети' })).toBeVisible()
    await expect(page.getByText('Что можно сделать')).toBeVisible()
    await page.getByRole('button', { name: 'На главный экран' }).click()
    await expect(page.getByRole('heading', { name: 'С кем созвонимся?' })).toBeVisible()
  } finally {
    await app.close()
  }
})

test('when the host closes the room, the guest sees «Хост закрыл комнату»', async () => {
  const host = await launchApp()
  try {
    const port = await freePort()
    const state = await host.page.evaluate(
      (p) =>
        window.ratatosk.host.start({ port: p, portMapping: false, roomName: 'Кино', password: '' }),
      port,
    )
    if (state.status !== 'running') throw new Error('host did not start')
    const client = await launchApp({
      args: [`ratatosk://join?v=1&h=127.0.0.1&p=${port}&r=kino&fp=${state.fingerprint}`],
    })
    try {
      const page = client.page
      await page.getByLabel('Твоё имя').fill('Катя')
      await page.getByRole('button', { name: 'Войти в комнату' }).click()
      await expect(page.getByText(/Ты в комнате «Кино»/)).toBeVisible()

      await host.page.evaluate(() => window.ratatosk.host.stop())

      await expect(page.getByRole('heading', { name: 'Хост закрыл комнату' })).toBeVisible()
      await expect(page.getByText('Комната «Кино» закрыта.', { exact: false })).toBeVisible()
    } finally {
      await client.app.close()
    }
  } finally {
    await host.app.close()
  }
})
