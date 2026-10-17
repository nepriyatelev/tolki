import { expect, test } from '@playwright/test'
import { launchApp } from './app'

test('renderer process runs in the OS sandbox', async () => {
  // webPreferences themselves are covered by src/main/window-options.test.ts; here we check
  // the effect at runtime. Electron reports `sandboxed` on macOS and Windows only.
  test.skip(process.platform === 'linux', 'ProcessMetric.sandboxed is not reported on Linux')
  const { app } = await launchApp()
  try {
    const tabs = await app.evaluate(({ app: electronApp }) =>
      electronApp.getAppMetrics().filter((m) => m.type === 'Tab'),
    )

    expect(tabs.length).toBeGreaterThan(0)
    for (const tab of tabs) expect(tab.sandboxed).toBe(true)
  } finally {
    await app.close()
  }
})

test('renderer has no Node APIs, only the typed bridge', async () => {
  const { app, page } = await launchApp()
  try {
    const globals = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>
      return {
        require: typeof w['require'],
        process: typeof w['process'],
        module: typeof w['module'],
        Buffer: typeof w['Buffer'],
        bridge: Object.keys(window.ratatosk).sort(),
        hostApi: Object.keys(window.ratatosk.host).sort(),
        screenApi: Object.keys(window.ratatosk.screen).sort(),
      }
    })

    expect(globals).toEqual({
      require: 'undefined',
      process: 'undefined',
      module: 'undefined',
      Buffer: 'undefined',
      bridge: ['app', 'host', 'invite', 'network', 'recent', 'room', 'screen', 'settings'],
      hostApi: ['getFingerprint', 'getState', 'onState', 'start', 'stop'],
      screenApi: ['listSources', 'openPermissionSettings', 'select'],
    })

    const info = await page.evaluate(() => window.ratatosk.app.getInfo())
    expect(info.name).toBe('Ratatosk')
  } finally {
    await app.close()
  }
})

test('a strict CSP is applied to the renderer', async () => {
  const { app, page } = await launchApp()
  try {
    const csp = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content')

    expect(csp).toContain("default-src 'none'")
    expect(csp).not.toContain('unsafe-inline')

    // An inline script must be blocked by the policy.
    const inlineRan = await page.evaluate(() => {
      const el = document.createElement('script')
      el.textContent = 'window.__inline = true'
      document.head.append(el)
      return (window as unknown as Record<string, unknown>)['__inline'] === true
    })
    expect(inlineRan).toBe(false)
  } finally {
    await app.close()
  }
})
