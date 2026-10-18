import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  clipboard,
  net,
  safeStorage,
  session,
  shell,
  utilityProcess,
  desktopCapturer,
  systemPreferences,
} from 'electron'
import Store from 'electron-store'
import { APP_NAME, DOWNLOAD_PAGE } from '@shared/app'
import { DEFAULT_HOST_PORT } from '@shared/host-protocol'
import type { RecentStatus } from '@shared/recent'
import { buildInvite, parseInvite } from '@shared/invite'
import { loadOrCreateCertificate } from '../host/certificate'
import { integrateAppImage } from './appimage-integration'
import { HostProcess, HostStartError } from './host-process'
import { findInviteLink, InviteLinks } from './invite-links'
import { NetworkChecker } from './network-check'
import { RecentRooms } from './recent-rooms'
import { joinRoom, probeRoom } from './room-client'
import { RoomSession } from './room-session'
import { SettingsStore } from './settings'
import { measureUpload } from './speed-test'
import { UpdateCheck } from './update-check'
import { UploadEstimator } from './upload-estimator'
import { registerIpcHandlers } from './ipc'
import { isTrustedRendererOrigin, isTrustedRendererUrl } from './trusted-url'
import { ScreenCapture } from './screen-capture'
import { mainWindowOptions } from './window-options'

// Lets e2e tests isolate the certificate and settings from the real profile.
const userDataOverride = process.env['TOLKI_USER_DATA']
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

// TOLKI_PORT_MAPPING=off never touches the router (e2e tests, manual port forwarding).
const portMappingEnabled = process.env['TOLKI_PORT_MAPPING'] !== 'off'

// TOLKI_SPEED_TEST=off never contacts speed.cloudflare.com (e2e tests).
const speedTestAllowed = process.env['TOLKI_SPEED_TEST'] !== 'off'

// Packaged builds only: a development build is always «older». TOLKI_UPDATE_CHECK=off never
// contacts GitHub (e2e tests); TOLKI_UPDATE_API points the check elsewhere (an e2e stub).
const updateApi = process.env['TOLKI_UPDATE_API']
const updates = new UpdateCheck({
  enabled: process.env['TOLKI_UPDATE_CHECK'] !== 'off' && (app.isPackaged || !!updateApi),
  currentVersion: app.getVersion(),
  fetch: (url, init) => net.fetch(url, init),
  ...(updateApi ? { url: updateApi } : {}),
})

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
  utilityProcess.fork(join(__dirname, 'host.js'), [], { serviceName: 'Tolki Host' })
const host = new HostProcess({ spawn: spawnHost })
const network = new NetworkChecker({
  host,
  portMappingEnabled,
  spawn: () =>
    utilityProcess.fork(join(__dirname, 'host.js'), [], { serviceName: 'Tolki Network Check' }),
})

const screenCapture = new ScreenCapture({
  getSources: (options) => desktopCapturer.getSources(options),
  platform: process.platform,
  screenAccess: () =>
    process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted',
  env: process.env,
})
// Wayland: screen capture goes through the desktop portal (PipeWire).
if (process.platform === 'linux')
  app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer')

/** macOS privacy pane for «Запись экрана». */
const SCREEN_PRIVACY_SETTINGS =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'

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

// Created on first use: safeStorage needs the app to be ready on Linux.
let recentRoomsStore: RecentRooms | null = null
function recentRooms(): RecentRooms {
  if (!recentRoomsStore) {
    const file = new Store({ name: 'recent-rooms' })
    recentRoomsStore = new RecentRooms(
      {
        read: () => file.get('rooms'),
        write: (rooms) => {
          file.set('rooms', rooms)
        },
      },
      {
        // On Linux without a keyring safeStorage falls back to a fixed key: treat as unavailable.
        available:
          safeStorage.isEncryptionAvailable() &&
          !(
            process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'
          ),
        encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
        decrypt: (encrypted) => safeStorage.decryptString(Buffer.from(encrypted, 'base64')),
      },
    )
  }
  return recentRoomsStore
}

// The room this app is a client of (also when the host user joins their own room).
let roomSession: RoomSession | null = null

function leaveRoom(): void {
  roomSession?.leave()
  roomSession = null
}

function registerInviteScheme(): void {
  if (!app.isPackaged) return
  // macOS: Info.plist from electron-builder `protocols`; Linux deb: its .desktop file.
  if (process.platform === 'win32') app.setAsDefaultProtocolClient('tolki')
  const appImage = process.env['APPIMAGE']
  if (process.platform === 'linux' && appImage) {
    void integrateAppImage({
      appImagePath: appImage,
      home: homedir(),
      iconSource: join(process.resourcesPath, 'icons/tolki.png'),
    })
  }
}

/** Packaged: copied next to the app (extraResources); in development: from build/. */
function linuxWindowIcon(): string | undefined {
  if (process.platform !== 'linux') return undefined
  return app.isPackaged
    ? join(process.resourcesPath, 'icons/tolki-512.png')
    : join(app.getAppPath(), 'build/icons/512x512.png')
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow(
    mainWindowOptions(join(__dirname, '../preload/index.js'), linuxWindowIcon()),
  )
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
    'app:copy-text': async (text) => {
      await clipboard.writeText(text)
      return null
    },
    'app:open-download-page': async () => {
      await shell.openExternal(DOWNLOAD_PAGE)
      return null
    },
    'app:check-update': () => updates.check(),
    'app:get-info': () => ({
      name: APP_NAME,
      version: app.getVersion(),
      platform: process.platform,
    }),
    'host:start': async ({ port, portMapping, roomName, password, screenMode }) => {
      try {
        return await host.start({
          port: port ?? DEFAULT_HOST_PORT,
          portMapping: portMappingEnabled && (portMapping ?? true),
          roomName: roomName ?? 'Комната',
          password: password ?? '',
          screenMode: screenMode ?? 'auto',
          dataDir: app.getPath('userData'),
        })
      } catch (error) {
        if (error instanceof HostStartError) return host.state
        throw error
      }
    },
    'host:stop': () => host.stop(),
    'host:get-state': () => host.state,
    'host:get-fingerprint': async () =>
      (await loadOrCreateCertificate(app.getPath('userData'))).fingerprint,
    'network:check': ({ force, port }) =>
      network.check(port ?? DEFAULT_HOST_PORT, { force: force ?? false }),
    'network:measure-upload': ({ force }) => upload.measure({ force: force ?? false }),
    'settings:get': () => settings.get(),
    'settings:update': (patch) => settings.update(patch),
    'invite:take-pending': () => inviteLinks.takePending(),
    'room:join': async ({ invite, name, password, recentId }) => {
      // Re-validate: the renderer's invite must survive the strict parser like a link would.
      let checked
      try {
        checked = parseInvite(buildInvite(invite))
      } catch {
        throw new Error('Invalid invite')
      }
      if (!checked.ok) throw new Error('Invalid invite')
      leaveRoom()
      const saved =
        password === undefined && recentId ? recentRooms().password(recentId) : undefined
      const used = password ?? checked.invite.password ?? saved
      const joinRequest = { invite: checked.invite, name, password: used }
      const connection = await joinRoom(joinRequest)
      const { result } = connection
      if (result.ok) {
        const send = (): Electron.WebContents | undefined =>
          BrowserWindow.getAllWindows()[0]?.webContents
        // The link may drop and come back (PLAN #31); the session keeps the room for the user.
        const session: RoomSession = new RoomSession(
          connection,
          joinRequest,
          {
            // A session the user left is silent, so these need no extra check; the first
            // events (who already talks) arrive while the session is being created.
            onReconnecting: () => send()?.send('room:reconnecting', null),
            onReconnected: (rejoined) => send()?.send('room:reconnected', rejoined),
            onEvent: (event) => send()?.send('room:event', event),
            onClosed: (reason) => {
              if (roomSession !== session) return
              roomSession = null
              send()?.send('room:closed', { reason, roomName: result.room.name })
            },
          },
          { join: joinRoom },
        )
        roomSession = session
        recentRooms().remember(
          checked.invite,
          result.room.name,
          result.room.hasPassword ? used : '',
        )
        settings.update({ profile: { name } })
      } else if (result.error === 'WRONG_PASSWORD' && saved !== undefined && recentId) {
        // The host changed the password: stop using the saved one.
        recentRooms().forgetPassword(recentId)
      }
      return result
    },
    'room:leave': () => {
      leaveRoom()
      return null
    },
    'room:request': (request) =>
      roomSession?.request(request) ?? Promise.resolve({ ok: false, error: 'not in a room' }),
    'room:preview': (invite) => probeRoom(invite),
    'recent:list': () => recentRooms().list(),
    'recent:probe': async () => {
      const rooms = recentRooms().list()
      const previews = await Promise.all(rooms.map((room) => probeRoom(room.invite)))
      const statuses = previews.map((p): RecentStatus =>
        p.status === 'live' ? { status: 'live', peerCount: p.room.peerCount } : p,
      )
      return Object.fromEntries(
        rooms.map((room, i) => [room.id, statuses[i] ?? { status: 'offline' }]),
      )
    },
    'recent:remove': (id) => recentRooms().remove(id),
    'screen:list-sources': () => screenCapture.list(),
    'screen:select': (id) => screenCapture.select(id),
    'screen:open-permission-settings': async () => {
      if (process.platform === 'darwin') await shell.openExternal(SCREEN_PRIVACY_SETTINGS)
      return null
    },
  },
  isTrustedUrl,
)

void app.whenReady().then(() => {
  if (!isPrimaryInstance) return
  registerInviteScheme()

  // Only our own window may use the microphone; every other permission stays denied.
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(
      permission === 'media' &&
        isTrustedUrl(details.requestingUrl) &&
        'mediaTypes' in details &&
        (details.mediaTypes ?? []).every((type) => type === 'audio'),
    )
  })
  session.defaultSession.setPermissionCheckHandler(
    (_contents, permission, requestingOrigin) =>
      permission === 'media' && isTrustedRendererOrigin(requestingOrigin, { devServerUrl }),
  )

  // getDisplayMedia() gets only the source the user picked in our dialog (or the Wayland portal).
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    if (!isTrustedUrl(request.frame?.url ?? '')) {
      callback({})
      return
    }
    void screenCapture.take().then(
      (source) => {
        callback(source ? { video: source as Electron.DesktopCapturerSource } : {})
      },
      () => {
        callback({})
      },
    )
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
