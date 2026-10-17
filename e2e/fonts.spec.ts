import { expect, test } from '@playwright/test'
import { launchApp } from './app'

test('bundled fonts load from the app itself', async () => {
  const { app, page } = await launchApp()
  try {
    const remote: string[] = []
    page.on('request', (request) => {
      if (!request.url().startsWith('file:')) remote.push(request.url())
    })

    const loaded = await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all([
        document.fonts.load('16px "Onest Variable"', 'Привет'),
        document.fonts.load('16px "JetBrains Mono Variable"', '12:48'),
      ])
      return {
        onest: document.fonts.check('16px "Onest Variable"', 'Привет'),
        mono: document.fonts.check('16px "JetBrains Mono Variable"', '12:48'),
        bodyFont: getComputedStyle(document.body).fontFamily,
      }
    })

    expect(loaded.onest).toBe(true)
    expect(loaded.mono).toBe(true)
    expect(loaded.bodyFont).toContain('Onest Variable')
    expect(remote).toEqual([])
  } finally {
    await app.close()
  }
})
