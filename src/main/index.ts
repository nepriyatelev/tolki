import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, session, utilityProcess } from 'electron'
import { APP_NAME } from '@shared/app'
import { DEFAULT_HOST_PORT } from '@shared/host-protocol'
import { HostProcess, HostStartError } from './host-process'
import { NetworkChecker } from './network-check'
import { registerIpcHandlers } from './ipc'
import { isTrustedRendererUrl } from './trusted-url'
import { mainWindowOptions } from './window-options'

// Lets e2e tests isolate the certificate and settings from the real profile.
const userDataOverride = process.env['RATATOSK_USER_DATA']
if (userDataOverride) app.setPath('userData', userDataOverride)

const devServerUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']
const rendererIndexPath = join(__dirname, '../renderer/index.html')
const isTrustedUrl = (url: string): boolean =>
  isTrustedRendererUrl(url, {
    devServerUrl,
    indexFileUrl: pathToFileURL(rendererIndexPath).href,
  })

// RATATOSK_PORT_MAPPING=off never touches the router (e2e tests, manual port forwarding).
const portMappingEnabled = process.env['RATATOSK_PORT_MAPPING'] !== 'off'

const spawnHost = () =>
  utilityProcess.fork(join(__dirname, 'host.js'), [], { serviceName: 'Ratatosk Host' })
const host = new HostProcess({ spawn: spawnHost })
const network = new NetworkChecker({
  host,
  portMappingEnabled,
  spawn: () =>
    utilityProcess.fork(join(__dirname, 'host.js'), [], { serviceName: 'Ratatosk Network Check' }),
})

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow(mainWindowOptions(join(__dirname, '../preload/index.js')))

  win.once('ready-to-show', () => {
    win.show()
  })

  if (devServerUrl) {
    void win.loadURL(devServerUrl)
  } else {
    void win.loadFile(rendererIndexPath)
  }

  return win
}

// Every webContents: no popups, no webviews, no navigation away from our renderer.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
  contents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault()
  })
})

host.onState((state) => {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('host:state', state)
})

registerIpcHandlers(
  {
    'app:get-info': () => ({
      name: APP_NAME,
      version: app.getVersion(),
      platform: process.platform,
    }),
    'host:start': async ({ port, portMapping }) => {
      try {
        return await host.start({
          port: port ?? DEFAULT_HOST_PORT,
          portMapping: portMappingEnabled && (portMapping ?? true),
          dataDir: app.getPath('userData'),
        })
      } catch (error) {
        if (error instanceof HostStartError) return host.state
        throw error
      }
    },
    'host:stop': () => host.stop(),
    'host:get-state': () => host.state,
    'network:check': ({ force }) => network.check(DEFAULT_HOST_PORT, { force: force ?? false }),
  },
  isTrustedUrl,
)

void app.whenReady().then(() => {
  // Deny every permission until a feature needs one (microphone arrives with issue #17).
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false)
  })

  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Stop the host process before quitting so it can release ports and mappings.
app.on('before-quit', (event) => {
  if (host.state.status === 'stopped') return
  event.preventDefault()
  void host.stop().finally(() => {
    app.quit()
  })
})
