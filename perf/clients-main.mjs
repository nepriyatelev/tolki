// The load test's participants (PLAN #33): one Electron, one hidden window per participant,
// fake microphone and camera. Not the app: only the call code runs in these pages.
import { app, BrowserWindow, session } from 'electron'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

app.commandLine.appendSwitch('use-fake-device-for-media-stream')
app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
// The organizer's certificate is self-signed; the app pins it, these test pages just accept it.
app.commandLine.appendSwitch('ignore-certificate-errors')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
// Hidden windows may still play audio (at zero volume) without a click.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

const [url, mediaHost, count] = process.argv.slice(-3)

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_c, _p, callback) => callback(true))
  const page = pathToFileURL(join(import.meta.dirname, '.build', 'index.html'))
  for (let i = 0; i < Number(count); i++) {
    const win = new BrowserWindow({
      show: false,
      webPreferences: { backgroundThrottling: false },
    })
    const query = new URLSearchParams({
      url,
      mediaHost,
      name: `Участник ${i + 1}`,
      share: i === 0 ? '1' : '0',
    })
    void win.loadURL(`${page.href}?${query}`)
  }
})
