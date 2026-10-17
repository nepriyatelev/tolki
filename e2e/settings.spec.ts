import { expect, test } from '@playwright/test'
import { launchApp } from './app'

test('settings default to the speed test being on and survive a restart', async () => {
  const first = await launchApp()
  try {
    expect(await first.page.evaluate(() => window.ratatosk.settings.get())).toEqual({
      speedTest: { enabled: true },
      profile: { name: '' },
      audio: { inputDeviceId: '' },
    })
    expect(
      await first.page.evaluate(() =>
        window.ratatosk.settings.update({ speedTest: { enabled: false } }),
      ),
    ).toEqual({
      speedTest: { enabled: false },
      profile: { name: '' },
      audio: { inputDeviceId: '' },
    })
  } finally {
    await first.app.close()
  }

  const second = await launchApp({ userDataDir: first.userDataDir })
  try {
    expect(await second.page.evaluate(() => window.ratatosk.settings.get())).toEqual({
      speedTest: { enabled: false },
      profile: { name: '' },
      audio: { inputDeviceId: '' },
    })
  } finally {
    await second.app.close()
  }
})

test('unknown settings are rejected by IPC validation', async () => {
  const { app, page } = await launchApp()
  try {
    const error = await page.evaluate(() =>
      window.ratatosk.settings.update({ telemetry: true } as never).then(
        () => null,
        (e: unknown) => String(e),
      ),
    )

    expect(error).toContain('settings:update')
  } finally {
    await app.close()
  }
})

test('the speed test never runs in e2e (RATATOSK_SPEED_TEST=off)', async () => {
  const { app, page } = await launchApp()
  try {
    expect(
      await page.evaluate(() => window.ratatosk.network.measureUpload({ force: true })),
    ).toEqual({
      status: 'disabled',
    })
  } finally {
    await app.close()
  }
})
