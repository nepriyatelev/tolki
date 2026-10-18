import type { PermissionKind, PermissionState } from '@shared/permissions'

/** systemPreferences.getMediaAccessStatus: 'not-determined' | 'granted' | 'denied' | … */
type MediaAccessStatus = string

export interface PermissionsOptions {
  platform: NodeJS.Platform
  status: (kind: PermissionKind) => MediaAccessStatus
  /** macOS: the system dialog (systemPreferences.askForMediaAccess). */
  ask: (kind: 'microphone') => Promise<boolean>
  openUrl: (url: string) => Promise<void>
  /**
   * e2e: nothing is asked — «not asked yet» counts as allowed, so there is neither our word nor
   * a system dialog on a CI runner. A real refusal stays a refusal.
   */
  skip?: boolean
}

/** The privacy pane where the user allows it, or null where there is none. */
export function settingsUrl(platform: NodeJS.Platform, kind: PermissionKind): string | null {
  if (platform === 'darwin') {
    const pane = kind === 'microphone' ? 'Privacy_Microphone' : 'Privacy_ScreenCapture'
    return `x-apple.systempreferences:com.apple.preference.security?${pane}`
  }
  // «Разрешить классическим приложениям доступ к микрофону» is on this page too.
  if (platform === 'win32' && kind === 'microphone') return 'ms-settings:privacy-microphone'
  return null
}

/**
 * OS permissions (#85). macOS asks once per permission and then only the user can change it in
 * the settings; «Запись экрана» takes effect after a restart. Windows has no dialog for desktop
 * apps, only the privacy switches; Linux asks nothing (Wayland's portal asks per share).
 */
export class Permissions {
  #screenAtStart: PermissionState | null = null
  #screenSettingsOpened = false

  constructor(private readonly options: PermissionsOptions) {}

  /** Remembers «Запись экрана» as Tolki started with it; call once the app is ready. */
  start(): void {
    this.#screenAtStart ??= this.#plain('screen')
  }

  status(kind: PermissionKind): PermissionState {
    const now = this.#plain(kind)
    if (kind !== 'screen' || this.options.platform !== 'darwin') return now
    this.start()
    // Allowed since Tolki started, or the user went to allow it: macOS needs a restart for it.
    if (now === 'granted') return this.#screenAtStart === 'granted' ? 'granted' : 'restart-needed'
    return this.#screenSettingsOpened ? 'restart-needed' : now
  }

  /** The microphone on macOS: the system dialog, once; elsewhere just the state. */
  async request(kind: 'microphone'): Promise<PermissionState> {
    if (this.status(kind) === 'not-asked') await this.options.ask(kind).catch(() => false)
    return this.status(kind)
  }

  async openSettings(kind: PermissionKind): Promise<void> {
    const url = settingsUrl(this.options.platform, kind)
    if (url === null) return
    if (kind === 'screen') this.#screenSettingsOpened = true
    await this.options.openUrl(url)
  }

  #plain(kind: PermissionKind): PermissionState {
    const { platform, skip } = this.options
    if (platform === 'linux') return 'granted'
    if (platform === 'win32' && kind === 'screen') return 'granted'
    const status = this.options.status(kind)
    if (status === 'denied' || status === 'restricted') return 'denied'
    if (status === 'not-determined' && platform === 'darwin' && !skip) return 'not-asked'
    return 'granted'
  }
}
