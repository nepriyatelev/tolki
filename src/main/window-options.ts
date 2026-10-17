import type { BrowserWindowConstructorOptions } from 'electron'
import { APP_NAME } from '@shared/app'

export function mainWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    title: APP_NAME,
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#111315',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  }
}
