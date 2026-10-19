import { test } from '@playwright/test'
import { launchApp } from './app'

// #123, diagnostics workflow only: window previews or window icons — which one blocks the main
// process on this runner. A fresh app for each, since a hang blocks the whole process.
const variants = {
  'window previews, no icons': {
    types: ['window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: false,
  },
  'window icons, no previews': {
    types: ['window'],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: true,
  },
}

for (const [name, options] of Object.entries(variants)) {
  test(`getSources: ${name} (#123)`, async () => {
    test.skip(!process.env['E2E_SCREEN_DIAG'], 'diagnostics workflow only')
    test.setTimeout(60_000)
    const { app } = await launchApp()
    try {
      const result = await Promise.race([
        app.evaluate(async ({ desktopCapturer }, opts) => {
          const started = Date.now()
          const list = await desktopCapturer.getSources(opts as Electron.SourcesOptions)
          return `${list.length} sources in ${Date.now() - started} ms`
        }, options),
        new Promise<string>((resolve) => setTimeout(() => resolve('no answer in 20 s'), 20_000)),
      ])
      console.log(`[diag] getSources, ${name} →`, result)
    } finally {
      await Promise.race([app.close(), new Promise((r) => setTimeout(r, 5000))])
      app.process().kill('SIGKILL')
    }
  })
}
