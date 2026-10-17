import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, net, session, utilityProcess } from 'electron'
import Store from 'electron-store'
import { APP_NAME } from '@shared/app'
import { DEFAULT_HOST_PORT } from '@shared/host-protocol'
import { buildInvite, parseInvite } from '@shared/invite'
import { integrateAppImage } from './appimage-integration'
import { HostProcess, HostStartError } from './host-process'
import { findInviteLink, InviteLinks } from './invite-links'
import { NetworkChecker } from './network-check'
import { joinRoom, type RoomConnection } from './room-client'
import { SettingsStore } from './settings'
import { measureUpload } from './speed-test'
import { UploadEstimator } from './upload-estimator'
import { registerIpcHandlers } from './ipc'
import { isTrustedRendererUrl } from './trusted-url'
import { mainWindowOptions } from './window-options'

// Lets e2e tests isolate the certificate and settings from the real profile.
const userDataOverride = process.env['RATATOSK_USER_DATA']
if (userDataOverride) app.setPath('userData', userDataOverride)

// One app per profile: a second launch (e.g. a clicked invite link) hands its arguments to the
// running one via 'second-instance' and quits.
const isPrimaryInstance = app.requestSingleInstanceLock()
if (!isPrimaryInstance) app.quit()

const devServerUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']
const rendererIndexPath = join(__dirname, '../renderer/index.html')
const isTrustedUrl = (url: string): boolean =>
  isTrustedRendererUrl(url, {
    devServerUrl,
    indexFileUrl: pathToFileURL(rendererIndexPath).href,
  })

// RATATOSK_PORT_MAPPING=off never touches the router (e2e tests, manual port forwarding).
const portMappingEnabled = process.env['RATATOSK_PORT_MAPPING'] !== 'off'

// RATATOSK_SPEED_TEST=off never contacts speed.cloudflare.com (e2e tests).
const speedTestAllowed = process.env['RATATOSK_SPEED_TEST'] !== 'off'

const store = new Store({ name: 'settings' })
const settings = new SettingsStore({
  read: () => store.store,
  write: (value) => {
    store.store = value
  },
})
const upload = new UploadEstimator({
  isEnabled: () => speedTestAllowed && settings.get().speedTest.enabled,
  // net.fetch uses Chromium's network stack, so system proxy settings apply.
  measure: () => measureUpload({ fetch: (url, init) => net.fetch(url, init) }),
})

const spawnHost = () =>
  utilityProcess.fork(join(__dirname, 'host.js'), [], { serviceName: 'Ratatosk Host' })
const host = new HostProcess({ spawn: spawnHost })
const network = new NetworkChecker({
  host,
  portMappingEnabled,
  spawn: () =>
    utilityProcess.fork(join(__dirname, 'host.js'), [], { serviceName: 'Ratatosk Network Check' }),
})

const inviteLinks = new InviteLinks((result) => {
  BrowserWindow.getAllWindows()[0]?.webContents.send('invite:opened', result)
})

function focusMainWindow(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

// Windows and Linux pass the link as an argument, both on first start and to a second instance.
const startupLink = findInviteLink(process.argv)
if (startupLink) inviteLinks.receive(startupLink)

app.on('second-instance', (_event, argv) => {
  const link = findInviteLink(argv)
  if (link) inviteLinks.receive(link)
  focusMainWindow()
})

// macOS delivers links as an event, possibly before the app is ready.
app.on('open-url', (event, url) => {
  event.preventDefault()
  inviteLinks.receive(url)
  focusMainWindow()
})

// The room this app is a client of (also when the host user joins their own room).
let roomConnection: RoomConnection | null = null

function leaveRoom(): void {
  roomConnection?.close()
  roomConnection = null
}

function registerInviteScheme(): void {
  if (!app.isPackaged) return
  // macOS: Info.plist from electron-builder `protocols`; Linux deb: its .desktop file.
  if (process.platform === 'win32') app.setAsDefaultProtocolClient('ratatosk')
  const appImage = process.env['APPIMAGE']
  if (process.platform === 'linux' && appImage) {
    void integrateAppImage({
      appImagePath: appImage,
      home: homedir(),
      iconSource: join(process.resourcesPath, 'icons/ratatosk.png'),
    })
  }
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow(mainWindowOptions(join(__dirname, '../preload/index.js')))
  win.webContents.on('did-start-loading', () => {
    inviteLinks.rendererGone()
  })

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
    'host:start': async ({ port, portMapping, roomName, password }) => {
      try {
        return await host.start({
          port: port ?? DEFAULT_HOST_PORT,
          portMapping: portMappingEnabled && (portMapping ?? true),
          roomName: roomName ?? 'Комната',
          password: password ?? '',
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
    'network:measure-upload': ({ force }) => upload.measure({ force: force ?? false }),
    'settings:get': () => settings.get(),
    'settings:update': (patch) => settings.update(patch),
    'invite:take-pending': () => inviteLinks.takePending(),
    'room:join': async ({ invite, name, password }) => {
      // Re-validate: the renderer's invite must survive the strict parser like a link would.
      let checked
      try {
        checked = parseInvite(buildInvite(invite))
      } catch {
        throw new Error('Invalid invite')
      }
      if (!checked.ok) throw new Error('Invalid invite')
      leaveRoom()
      const connection = await joinRoom({
        invite: checked.invite,
        name,
        password: password ?? checked.invite.password,
      })
      if (connection.result.ok) roomConnection = connection
      return connection.result
    },
    'room:leave': () => {
      leaveRoom()
      return null
    },
  },
  isTrustedUrl,
)

void app.whenReady().then(() => {
  if (!isPrimaryInstance) return
  registerInviteScheme()

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
  leaveRoom()
  if (host.state.status === 'stopped') return
  event.preventDefault()
  void host.stop().finally(() => {
    app.quit()
  })
})
