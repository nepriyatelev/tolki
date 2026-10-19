import { test } from '@playwright/test'
import { launchApp } from './app'

// #123, diagnostics workflow only: which desktopCapturer.getSources call hangs on this runner.
test('which getSources hangs (#123)', async () => {
  test.skip(!process.env['E2E_SCREEN_DIAG'], 'diagnostics workflow only')
  test.setTimeout(180_000)
  const { app } = await launchApp()
  try {
    const variants = [
      { types: ['screen'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false },
      { types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false },
      { types: ['screen'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false },
      { types: ['window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true },
    ]
    for (const options of variants) {
      const result = await app.evaluate(async ({ desktopCapturer }, opts) => {
        const started = Date.now()
        const timeout = new Promise<string>((resolve) =>
          setTimeout(() => resolve('timeout'), 20_000),
        )
        const sources = desktopCapturer
          .getSources(opts as Electron.SourcesOptions)
          .then((list) => `${list.length} sources`)
          .catch((error: unknown) => `error ${String(error)}`)
        return `${await Promise.race([sources, timeout])} in ${Date.now() - started} ms`
      }, options)
      console.log('[diag] getSources', JSON.stringify(options), '→', result)
    }
  } finally {
    await app.close()
  }
})
