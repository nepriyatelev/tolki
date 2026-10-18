import { expect, test } from '@playwright/test'
import { launchApp } from './app'

test('settings default to the speed test being on and survive a restart', async () => {
  const first = await launchApp()
  try {
    expect(await first.page.evaluate(() => window.tolki.settings.get())).toEqual({
      speedTest: { enabled: true },
      profile: { name: '' },
      audio: { inputDeviceId: '', outputDeviceId: '', peerVolumes: {} },
    })
    expect(
      await first.page.evaluate(() =>
        window.tolki.settings.update({ speedTest: { enabled: false } }),
      ),
    ).toEqual({
      speedTest: { enabled: false },
      profile: { name: '' },
      audio: { inputDeviceId: '', outputDeviceId: '', peerVolumes: {} },
    })
    // A friend's volume is remembered by name (PLAN #23).
    await first.page.evaluate(() =>
      window.tolki.settings.update({ audio: { peerVolumes: { Катя: 150 } } }),
    )
  } finally {
    await first.app.close()
  }

  const second = await launchApp({ userDataDir: first.userDataDir })
  try {
    expect(await second.page.evaluate(() => window.tolki.settings.get())).toEqual({
      speedTest: { enabled: false },
      profile: { name: '' },
      audio: { inputDeviceId: '', outputDeviceId: '', peerVolumes: { катя: 150 } },
    })
  } finally {
    await second.app.close()
  }
})

test('unknown settings are rejected by IPC validation', async () => {
  const { app, page } = await launchApp()
  try {
    const error = await page.evaluate(() =>
      window.tolki.settings.update({ telemetry: true } as never).then(
        () => null,
        (e: unknown) => String(e),
      ),
    )

    expect(error).toContain('settings:update')
  } finally {
    await app.close()
  }
})

test('the speed test never runs in e2e (TOLKI_SPEED_TEST=off)', async () => {
  const { app, page } = await launchApp()
  try {
    expect(await page.evaluate(() => window.tolki.network.measureUpload({ force: true }))).toEqual({
      status: 'disabled',
    })
  } finally {
    await app.close()
  }
})
