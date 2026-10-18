import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { cpus, homedir, release, totalmem } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  Menu,
  nativeImage,
  Notification,
  Tray,
  net,
  safeStorage,
  session,
  shell,
  utilityProcess,
  desktopCapturer,
  systemPreferences,
} from 'electron'
import Store from 'electron-store'
import electronUpdater from 'electron-updater'
import { APP_NAME, DOWNLOAD_PAGE } from '@shared/app'
import { isOpenableLink } from '@shared/chat'
import { systemAudioSupported } from '@shared/screen'
import { DEFAULT_HOST_PORT } from '@shared/host-protocol'
import type { RecentStatus } from '@shared/recent'
import type { RoomEvent } from '@shared/room'
import { buildInvite, parseInvite } from '@shared/invite'
import { loadOrCreateCertificate } from '../host/certificate'
import { appMenuTemplate } from './app-menu'
import { trayMenuTemplate, trayTooltip } from './tray-menu'
import { PushToTalk, type KeyHook } from './push-to-talk'
import { GlobalHotkeys } from './global-hotkeys'
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
import { AutoUpdate, type Updater } from './auto-update'
import { Permissions } from './permissions'
import { UploadEstimator } from './upload-estimator'
import { registerIpcHandlers } from './ipc'
import { isTrustedRendererOrigin, isTrustedRendererUrl } from './trusted-url'
import { ScreenCapture } from './screen-capture'
import { mainWindowOptions } from './window-options'
import type { TrayCallState } from '@shared/ipc'
import { LogPrivacy, logText, peerAlias, roomAlias } from './log-privacy'
import { createLoggers, lineWriter, mergeLogs, readLogs, savedLogName } from './logging'
import { networkCheckLine, uploadLine } from './log-events'

// Lets e2e tests isolate the certificate and settings from the real profile.
const userDataOverride = process.env['TOLKI_USER_DATA']
if (userDataOverride) app.setPath('userData', userDataOverride)

// Logs (#106): always on, in userData/logs, with personal data redacted on the way in.
const logDir = join(app.getPath('userData'), 'logs')
const privacy = new LogPrivacy({ home: homedir() })
const logs = createLoggers({ dir: logDir, privacy, console: !app.isPackaged })
/** Terminal colours Node adds to stack traces: not for a text file. */
// eslint-disable-next-line no-control-regex -- the escape character is exactly what goes
const ANSI_COLOURS = /\x1b\[[0-9;]*m/g
// The room and the network check report through their stdout/stderr.
const hostLog = (prefix: string, child: Electron.UtilityProcess): Electron.UtilityProcess => {
  child.stdout?.on(
    'data',
    lineWriter((line) => {
      logs.host.info(`${prefix}${line.replace(ANSI_COLOURS, '')}`)
    }),
  )
  child.stderr?.on(
    'data',
    lineWriter((line) => {
      logs.host.warn(`${prefix}${line.replace(ANSI_COLOURS, '')}`)
    }),
  )
  return child
}
// Errors nobody caught still end up in main.log.
process.on('uncaughtException', (error) => {
  logs.main.error(`uncaught: ${logText(error)}`)
})
process.on('unhandledRejection', (reason) => {
  logs.main.error(`unhandled rejection: ${logText(reason)}`)
})
// e2e must not open Finder / Explorer windows.
const showSavedLogs = process.env['TOLKI_SHOW_IN_FOLDER'] !== 'off'
// …nor a browser for a chat link.
const openChatLinks = process.env['TOLKI_OPEN_LINKS'] !== 'off'

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
// contacts GitHub (e2e tests); TOLKI_UPDATE_API is another base for both requests, the latest
// release and the list an alpha reads (an e2e stub).
const updateApi = process.env['TOLKI_UPDATE_API']
const updates = new UpdateCheck({
  enabled: process.env['TOLKI_UPDATE_CHECK'] !== 'off' && (app.isPackaged || !!updateApi),
  currentVersion: app.getVersion(),
  fetch: (url, init) => net.fetch(url, init),
  ...(updateApi
    ? { url: `${updateApi}/releases/latest`, releasesUrl: `${updateApi}/releases?per_page=10` }
    : {}),
})

// Auto-update (#46): Windows (NSIS) and Linux AppImage download the new version in the
// background and install it on quit; macOS (no Developer ID) and .deb get the banner with the
// download page. TOLKI_UPDATE_CONFIG is an app-update.yml pointing at a local feed (e2e): the
// AppImage updater then runs on any OS, as far as the download, which is what the test checks.
const updateConfig = process.env['TOLKI_UPDATE_CONFIG']
const autoUpdate = new AutoUpdate({
  updater: createUpdater(),
  fallback: () => updates.check(),
  onChange: (offer) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('app:update', offer)
  },
  log: logs.main,
})

function createUpdater(): Updater | null {
  if (process.env['TOLKI_UPDATE_CHECK'] === 'off' || !(app.isPackaged || updateConfig)) return null
  const updater =
    process.platform === 'win32' && !updateConfig
      ? new electronUpdater.NsisUpdater()
      : (process.platform === 'linux' && process.env['APPIMAGE']) || updateConfig
        ? new electronUpdater.AppImageUpdater()
        : null
  if (!updater) return null
  updater.logger = logs.main
  updater.autoDownload = true
  // In e2e nothing is installed: the test ends at «downloaded».
  updater.autoInstallOnAppQuit = !updateConfig
  if (updateConfig) {
    updater.forceDevUpdateConfig = true
    updater.updateConfigPath = updateConfig
    // The stub installer is no AppImage to diff against.
    updater.disableDifferentialDownload = true
  }
  return updater
}

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
  hostLog(
    '',
    utilityProcess.fork(join(__dirname, 'host.js'), [], {
      serviceName: 'Tolki Host',
      stdio: 'pipe',
    }),
  )
const host = new HostProcess({ spawn: spawnHost })
const network = new NetworkChecker({
  host,
  portMappingEnabled,
  spawn: () =>
    hostLog(
      '[network-check] ',
      utilityProcess.fork(join(__dirname, 'host.js'), [], {
        serviceName: 'Tolki Network Check',
        stdio: 'pipe',
      }),
    ),
})

// The computer's sound with the screen (#41). TOLKI_SYSTEM_AUDIO=fake (e2e): a hidden window's
// steady tone stands in for it, so the whole way can be checked where there is no loopback.
const fakeSystemAudio = process.env['TOLKI_SYSTEM_AUDIO'] === 'fake'
// OS permissions (#85). TOLKI_OS_PERMISSIONS=skip (e2e): no system dialogs on a CI runner.
const permissions = new Permissions({
  platform: process.platform,
  status: (kind) => systemPreferences.getMediaAccessStatus(kind),
  ask: (kind) => systemPreferences.askForMediaAccess(kind),
  openUrl: (url) => shell.openExternal(url),
  skip: process.env['TOLKI_OS_PERMISSIONS'] === 'skip',
})
const screenCapture = new ScreenCapture({
  getSources: (options) => desktopCapturer.getSources(options),
  platform: process.platform,
  screenPermission: () => permissions.status('screen'),
  env: process.env,
  systemAudio: fakeSystemAudio || systemAudioSupported(process.platform, release()),
})
let toneWindow: BrowserWindow | null = null
/** e2e only: a hidden window playing a tone, captured as if it were the computer's sound. */
async function fakeSystemAudioFrame(): Promise<Electron.WebFrameMain> {
  if (!toneWindow || toneWindow.isDestroyed()) {
    toneWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    await toneWindow.loadURL(
      'data:text/html,<script>const c=new AudioContext();const o=c.createOscillator();' +
        'o.frequency.value=330;o.connect(c.destination);o.start()</script>',
    )
  }
  return toneWindow.webContents.mainFrame
}
// Wayland: screen capture goes through the desktop portal (PipeWire).
if (process.platform === 'linux')
  // Wayland: screen capture through the portal (PipeWire), global hotkeys (#40) too.
  app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer,GlobalShortcutsPortal')

// Push-to-talk (PLAN #39). TOLKI_GLOBAL_KEYS=off keeps the key to the focused window (e2e: no
// real keyboard hook on the developer's machine, no macOS permission request).
const pushToTalk = new PushToTalk({
  loadHook: () => {
    try {
      // Native; loaded only when push-to-talk is first turned on.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const native = require('uiohook-napi') as {
        uIOhook: KeyHook
        UiohookKey: Record<string, number>
      }
      return { hook: native.uIOhook, keycodes: native.UiohookKey }
    } catch (error) {
      logs.main.warn(`push-to-talk: no global key hook: ${logText(error)}`)
      return null
    }
  },
  globalAllowed:
    process.env['TOLKI_GLOBAL_KEYS'] !== 'off' &&
    !(process.platform === 'linux' && process.env['XDG_SESSION_TYPE'] === 'wayland'),
  trusted: (ask) =>
    process.platform !== 'darwin' || systemPreferences.isTrustedAccessibilityClient(ask),
  onKey: (pressed) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('ptt:key', { pressed })
  },
})

// The user's global hotkeys for the microphone and the sound (PLAN #40), only during a call.
// globalShortcut is used only after the app is ready.
const hotkeys = new GlobalHotkeys(
  {
    register: (accelerator, callback) => globalShortcut.register(accelerator, callback),
    unregister: (accelerator) => {
      globalShortcut.unregister(accelerator)
    },
  },
  (action) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('hotkeys:pressed', { action })
  },
)

/** macOS privacy pane for «Универсальный доступ» (push-to-talk over other apps). */
const ACCESSIBILITY_SETTINGS =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'

const inviteLinks = new InviteLinks((result) => {
  BrowserWindow.getAllWindows()[0]?.webContents.send('invite:opened', result)
})

// The tray (PLAN #44): Windows and Linux. macOS keeps the app in the Dock, as Mac apps do.
let tray: Tray | null = null
let trayCall: TrayCallState = { inCall: false, roomName: '', muted: false, deafened: false }
/** Set by before-quit: then the window really closes. */
let quitting = false

function trayIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icons/tray.png')
    : join(app.getAppPath(), 'build/icons/16x16.png')
}

function sendTrayCommand(command: 'mute' | 'deafen' | 'leave'): void {
  BrowserWindow.getAllWindows()[0]?.webContents.send('tray:command', { command })
}

function refreshTray(): void {
  if (!tray) return
  const state = { ...trayCall, closeToTray: settings.get().tray.closeToTray }
  tray.setToolTip(trayTooltip(state))
  tray.setContextMenu(
    Menu.buildFromTemplate(
      trayMenuTemplate(state, {
        open: focusMainWindow,
        toggleMute: () => {
          sendTrayCommand('mute')
        },
        toggleDeafen: () => {
          sendTrayCommand('deafen')
        },
        leaveCall: () => {
          sendTrayCommand('leave')
        },
        setCloseToTray: (enabled) => {
          settings.update({ tray: { closeToTray: enabled } })
          refreshTray()
        },
        quit: () => {
          app.quit()
        },
      }),
    ),
  )
}

function createTray(): void {
  if (process.platform === 'darwin') return
  tray = new Tray(nativeImage.createFromPath(trayIconPath()))
  tray.on('click', focusMainWindow)
  refreshTray()
}

/** Once: the window went to the tray, the call goes on, quitting is in the tray's menu. */
function trayHintOnce(): void {
  if (!tray || settings.get().tray.hintShown || !Notification.isSupported()) return
  settings.update({ tray: { hintShown: true } })
  new Notification({
    title: 'Tolki работает в трее',
    body: 'Окно скрыто, звонок и комната продолжаются. Выйти — через значок в трее.',
  }).show()
}

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

/** Who comes and goes, mute, screens — under pseudonyms (#106). Speaking changes are too chatty. */
function logRoomEvent(event: RoomEvent): void {
  switch (event.type) {
    case 'peer-joined':
      privacy.addPeer(event.peer.id, event.peer.name)
      logs.main.info(`${peerAlias(event.peer.id)} joined`)
      return
    case 'peer-left':
      logs.main.info(`${peerAlias(event.peerId)} left`)
      return
    case 'peer-muted':
      logs.main.info(`${peerAlias(event.peerId)} ${event.muted ? 'muted' : 'unmuted'}`)
      return
    case 'screen-share-started':
    case 'screen-share-stopped':
      logs.main.info(`${peerAlias(event.peerId)}: ${event.type}`)
      return
    case 'screen-layer':
      logs.main.info(`screen stream for this viewer: ${event.layer === 1 ? '≈1080p' : '≈360p'}`)
      return
    case 'join-request':
      // Only that someone asks: the name stays out of the logs.
      logs.main.info('someone asks to be let in')
      return
    case 'approval-changed':
      logs.main.info(`entry by approval: ${event.enabled ? 'on' : 'off'}`)
      return
    case 'host-stats':
      // Every few seconds when it changes: not worth a line each time.
      return
    case 'screen-budget':
      logs.main.info(`screen ceiling from the organizer: ${event.height}p`)
      return
    default:
  }
}

/** The top of a saved log: what the app runs on (no names, no addresses). */
function systemInfo(): string {
  const gpu = app.getGPUFeatureStatus()
  const metrics = app
    .getAppMetrics()
    .map(
      (m) =>
        `${m.type}${m.name ? ` (${m.name})` : ''}: CPU ${m.cpu.percentCPUUsage.toFixed(1)} %, ${Math.round(m.memory.workingSetSize / 1024)} MB`,
    )
  const current = settings.get()
  return [
    `Tolki ${app.getVersion()} — saved ${new Date().toISOString()}`,
    `OS: ${process.platform} ${release()} ${process.arch}, locale ${app.getLocale()}`,
    `Electron ${process.versions.electron}, Chrome ${process.versions.chrome}, Node ${process.versions.node}`,
    `CPU: ${cpus()[0]?.model ?? 'unknown'} × ${cpus().length}, RAM ${Math.round(totalmem() / 1024 ** 3)} GB`,
    `GPU: video encode ${gpu.video_encode}, video decode ${gpu.video_decode}, compositing ${gpu.gpu_compositing}`,
    `Settings: upload speed test ${current.speedTest.enabled ? 'on' : 'off'}, ` +
      `microphone ${current.audio.inputDeviceId ? 'chosen' : 'system default'}, ` +
      `output ${current.audio.outputDeviceId ? 'chosen' : 'system default'}`,
    `Room: host ${host.state.status}${host.state.status === 'running' ? ` on port ${host.state.port}` : ''}, ${roomSession ? 'in a call' : 'not in a call'}`,
    'Processes:',
    ...metrics.map((line) => `  ${line}`),
  ].join('\n')
}

/** «Помощь → Сохранить логи…» (#106): one text file in Downloads, shown in its folder. */
async function saveLogs(): Promise<void> {
  try {
    const body = mergeLogs(await readLogs(logDir))
    const text = privacy.redact(`${systemInfo()}\n\n${body}\n`)
    const file = join(app.getPath('downloads'), savedLogName(new Date()))
    await writeFile(file, text, 'utf8')
    logs.main.info('logs saved for a report')
    if (showSavedLogs) shell.showItemInFolder(file)
  } catch (error) {
    logs.main.error(`could not save the logs: ${logText(error)}`)
  }
}

/** The organizer's key of the room this app runs (#42); a new one with every host:start. */
let organizerKey = ''
/** Stops a join that waits for the organizer (#42). */
let cancelJoin: AbortController | null = null

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
  // The window's cross hides it: the call and the room go on (PLAN #44). On macOS always, as Mac
  // apps do (the Dock brings it back); elsewhere to the tray, unless turned off in its menu.
  win.on('close', (event) => {
    if (quitting) return
    const hide = process.platform === 'darwin' || (tray !== null && settings.get().tray.closeToTray)
    if (!hide) return
    event.preventDefault()
    win.hide()
    trayHintOnce()
  })
  // The window's console goes to renderer.log: the call's events and warnings (#106).
  win.webContents.on('console-message', ({ level, message }) => {
    if (level === 'error') logs.renderer.error(message)
    else if (level === 'warning') logs.renderer.warn(message)
    else if (level === 'info') logs.renderer.info(message)
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    logs.main.error(`window process gone: ${details.reason} (exit ${details.exitCode})`)
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
  logs.main.info(
    `host ${state.status}` +
      (state.status === 'running' ? ` on port ${state.port}` : '') +
      (state.status === 'stopped' && state.lastError ? ` (${state.lastError})` : ''),
  )
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
    'app:open-link': async (url) => {
      // The renderer shows only http(s) as links; anything else is not opened, whatever it is.
      if (!isOpenableLink(url)) {
        logs.main.warn('a chat link that is not http(s) was not opened')
        return null
      }
      if (openChatLinks) await shell.openExternal(url)
      return null
    },
    'app:check-update': () => autoUpdate.offer(),
    'app:install-update': () => autoUpdate.install(),
    'app:relaunch': () => {
      logs.main.info('relaunch')
      app.relaunch()
      app.quit()
      return null
    },
    'app:get-info': () => ({
      name: APP_NAME,
      version: app.getVersion(),
      platform: process.platform,
    }),
    'host:start': async ({ port, portMapping, roomName, password, screenMode, approval }) => {
      if (roomName) privacy.addRoom('', roomName)
      if (password) privacy.addPassword(password)
      logs.main.info(
        `host start: port ${port ?? DEFAULT_HOST_PORT}, port mapping ${portMapping === false || !portMappingEnabled ? 'off' : 'on'}, ` +
          `screen mode ${screenMode ?? 'auto'}, password ${password ? 'yes' : 'no'}`,
      )
      try {
        const started = await host.start({
          port: port ?? DEFAULT_HOST_PORT,
          portMapping: portMappingEnabled && (portMapping ?? true),
          roomName: roomName ?? 'Комната',
          password: password ?? '',
          screenMode: screenMode ?? 'auto',
          approval: approval ?? false,
          // A new key for every room: only this app's own connection proves to be the organizer.
          organizerKey: (organizerKey = randomBytes(24).toString('base64url')),
          dataDir: app.getPath('userData'),
        })
        // The screen's ceiling (#86) starts from the last measurement; no new test mid-call.
        const measured = upload.lastMbps
        if (measured !== null) host.setUpload(measured)
        return started
      } catch (error) {
        if (error instanceof HostStartError) return host.state
        throw error
      }
    },
    'host:stop': () => host.stop(),
    'host:get-state': () => host.state,
    'host:get-fingerprint': async () =>
      (await loadOrCreateCertificate(app.getPath('userData'))).fingerprint,
    'network:check': async ({ force, port }) => {
      const result = await network.check(port ?? DEFAULT_HOST_PORT, { force: force ?? false })
      logs.main.info(networkCheckLine(result))
      return result
    },
    'network:measure-upload': async ({ force }) => {
      const result = await upload.measure({ force: force ?? false })
      logs.main.info(uploadLine(result))
      if (result.status === 'measured') host.setUpload(result.mbps)
      return result
    },
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
      // The organizer's own room (#42): their connection carries the key from host:start.
      const ownRoom =
        host.state.status === 'running' &&
        checked.invite.host === '127.0.0.1' &&
        checked.invite.port === host.state.port
      cancelJoin?.abort()
      const joining = new AbortController()
      cancelJoin = joining
      const joinRequest = {
        invite: checked.invite,
        name,
        password: used,
        ...(ownRoom ? { organizerKey } : {}),
        onWaiting: () => {
          logs.main.info('room join: waiting for the organizer')
          BrowserWindow.getAllWindows()[0]?.webContents.send('room:waiting', null)
        },
        signal: joining.signal,
      }
      privacy.addOwnName(name)
      if (used) privacy.addPassword(used)
      const target = checked.invite
      logs.main.info(
        `room join: ${target.hostKind} ${target.host} port ${target.port}, ` +
          `certificate ${target.fingerprint}, password ${used ? 'yes' : 'no'}`,
      )
      const connection = await joinRoom(joinRequest)
      if (cancelJoin === joining) cancelJoin = null
      const { result } = connection
      if (result.ok) {
        privacy.addRoom(target.roomId, result.room.name)
        privacy.addPeer(result.peerId, name, true)
        for (const peer of result.peers) privacy.addPeer(peer.id, peer.name)
        logs.main.info(
          `joined ${roomAlias(target.roomId)} as ${peerAlias(result.peerId)}` +
            `${result.organizer ? ' (organizer)' : ''}: ` +
            `${result.peers.length} others, screen mode ${result.screenMode}` +
            (result.sharerId ? `, ${peerAlias(result.sharerId)} is sharing` : ''),
        )
      } else {
        logs.main.warn(`room join failed: ${result.error}`)
      }
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
            onReconnecting: () => {
              logs.main.warn('room link lost, reconnecting')
              send()?.send('room:reconnecting', null)
            },
            onReconnected: (rejoined) => {
              logs.main.info(`room link back as ${peerAlias(rejoined.peerId)}`)
              privacy.addPeer(rejoined.peerId, name, true)
              for (const peer of rejoined.peers) privacy.addPeer(peer.id, peer.name)
              send()?.send('room:reconnected', rejoined)
            },
            onEvent: (event) => {
              logRoomEvent(event)
              send()?.send('room:event', event)
            },
            onClosed: (reason) => {
              logs.main.info(`room session ended: ${reason}`)
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
      // Also stops waiting for the organizer (#42).
      cancelJoin?.abort()
      cancelJoin = null
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
    'ptt:configure': (request) => {
      const mode = pushToTalk.configure(request)
      logs.main.info(`push-to-talk: ${mode}`)
      return mode
    },
    'hotkeys:configure': (request) => {
      const status = hotkeys.configure(request)
      logs.main.info(`global hotkeys: mute ${status.mute}, deafen ${status.deafen}`)
      return status
    },
    'tray:update': (state) => {
      trayCall = state
      refreshTray()
      return null
    },
    'ptt:open-permission-settings': async () => {
      if (process.platform === 'darwin') await shell.openExternal(ACCESSIBILITY_SETTINGS)
      return null
    },
    'permissions:status': (kind) => permissions.status(kind),
    'permissions:request': (kind) => permissions.request(kind),
    'permissions:open-settings': async (kind) => {
      await permissions.openSettings(kind)
      return null
    },
  },
  isTrustedUrl,
)

void app.whenReady().then(() => {
  if (!isPrimaryInstance) return
  permissions.start()
  logs.main.info(
    `start: Tolki ${app.getVersion()}, ${process.platform} ${release()} ${process.arch}, ` +
      `Electron ${process.versions.electron}${app.isPackaged ? '' : ' (development)'}`,
  )
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      appMenuTemplate({ platform: process.platform, onSaveLogs: () => void saveLogs() }),
    ),
  )
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
      async (source) => {
        if (!source) {
          callback({})
          return
        }
        // The window asked for the computer's sound too (only offered where it works, #41).
        const audio =
          request.audioRequested && screenCapture.systemAudio
            ? fakeSystemAudio
              ? await fakeSystemAudioFrame()
              : ('loopback' as const)
            : undefined
        callback({ video: source as Electron.DesktopCapturerSource, ...(audio ? { audio } : {}) })
      },
      () => {
        callback({})
      },
    )
  })

  createMainWindow()

  createTray()

  // The Dock icon (macOS) brings the hidden window back.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    else focusMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Stop the host process before quitting so it can release ports and mappings.
app.on('before-quit', (event) => {
  quitting = true
  pushToTalk.close()
  hotkeys.close()
  if (host.state.status === 'stopped') logs.main.info('quit')
  leaveRoom()
  if (host.state.status === 'stopped') return
  event.preventDefault()
  void host.stop().finally(() => {
    app.quit()
  })
})
