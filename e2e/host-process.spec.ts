import { expect, test, type ElectronApplication } from '@playwright/test'
import { launchApp } from './app'

function hostProcessCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(
    ({ app: electronApp }) =>
      electronApp.getAppMetrics().filter((m) => m.type === 'Utility' && m.name === 'Ratatosk Host')
        .length,
  )
}

test('main starts and stops the host utility process', async () => {
  const { app, page } = await launchApp()
  try {
    expect(await page.evaluate(() => window.ratatosk.host.getStatus())).toBe('stopped')
    expect(await hostProcessCount(app)).toBe(0)

    const events = page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const seen: string[] = []
          const off = window.ratatosk.host.onStatus((status) => {
            seen.push(status)
            if (status === 'stopped') {
              off()
              resolve(seen)
            }
          })
        }),
    )

    expect(await page.evaluate(() => window.ratatosk.host.start())).toBe('running')
    await expect.poll(() => hostProcessCount(app)).toBe(1)

    expect(await page.evaluate(() => window.ratatosk.host.stop())).toBe('stopped')
    await expect.poll(() => hostProcessCount(app)).toBe(0)

    expect(await events).toEqual(['starting', 'running', 'stopping', 'stopped'])
  } finally {
    await app.close()
  }
})

test('quitting the app stops a running host', async () => {
  const { app, page } = await launchApp()

  expect(await page.evaluate(() => window.ratatosk.host.start())).toBe('running')
  const pid = await app.evaluate(
    ({ app: electronApp }) =>
      electronApp.getAppMetrics().find((m) => m.name === 'Ratatosk Host')?.pid,
  )
  expect(pid).toBeDefined()

  await app.close()

  expect(() => process.kill(pid as number, 0)).toThrow()
})
