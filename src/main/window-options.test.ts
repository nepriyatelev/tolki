import { describe, expect, it } from 'vitest'
import { mainWindowOptions } from './window-options'

describe('mainWindowOptions', () => {
  it('locks down the renderer', () => {
    const prefs = mainWindowOptions('/app/out/preload/index.js').webPreferences

    expect(prefs).toMatchObject({
      preload: '/app/out/preload/index.js',
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    })
  })
})
