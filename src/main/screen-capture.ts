import type { PermissionState } from '@shared/permissions'
import type { CaptureSource, ScreenSourcesResult } from '@shared/screen'

/** The parts of Electron's DesktopCapturerSource we use. */
export interface DesktopSource {
  id: string
  name: string
  thumbnail: { toDataURL(): string; isEmpty(): boolean }
  appIcon: { toDataURL(): string; isEmpty(): boolean } | null
}

export interface ScreenCaptureOptions {
  getSources: (options: {
    types: ('screen' | 'window')[]
    thumbnailSize: { width: number; height: number }
    fetchWindowIcons: boolean
  }) => Promise<DesktopSource[]>
  platform: NodeJS.Platform
  /** macOS «Запись экрана» (#85); 'not-asked' lets macOS show its dialog on the first list. */
  screenPermission: () => PermissionState
  env: NodeJS.ProcessEnv
  /** The computer's sound can go along with the screen on this system (#41). */
  systemAudio: boolean
}

const THUMBNAIL = { width: 320, height: 180 }

/**
 * What the user may show and what getDisplayMedia() then gets (PLAN #26). The renderer only names
 * a source from the last list; main hands that source to Chromium, nothing else.
 */
export class ScreenCapture {
  #listed = new Map<string, DesktopSource>()

  /** The computer's sound can go along (#41). */
  get systemAudio(): boolean {
    return this.options.systemAudio && !this.usesSystemPicker
  }

  #selected: DesktopSource | null = null

  constructor(private readonly options: ScreenCaptureOptions) {}

  /** Wayland apps cannot see other windows; the desktop portal shows its own picker. */
  get usesSystemPicker(): boolean {
    const { env } = this.options
    return this.options.platform === 'linux' && env.XDG_SESSION_TYPE === 'wayland'
  }

  async list(): Promise<ScreenSourcesResult> {
    if (this.usesSystemPicker) return { picker: 'system' }
    const permission = this.options.screenPermission()
    if (permission === 'denied') return { picker: 'denied' }
    if (permission === 'restart-needed') return { picker: 'restart' }
    // Two calls, not one: when window listing fails (seen on Linux without a window manager),
    // a combined call returns nothing at all, screens included.
    const [screens, windows] = await Promise.all([
      this.options.getSources({
        types: ['screen'],
        thumbnailSize: THUMBNAIL,
        fetchWindowIcons: false,
      }),
      this.options
        .getSources({ types: ['window'], thumbnailSize: THUMBNAIL, fetchWindowIcons: true })
        .catch(() => []),
    ])
    const sources = [...screens, ...windows]
    this.#listed = new Map(sources.map((source) => [source.id, source]))
    return {
      picker: 'app',
      sources: sources.map(toCaptureSource),
      systemAudio: this.systemAudio,
    }
  }

  /** The user picked a source in our dialog; false if it was not in the list. */
  select(id: string): boolean {
    this.#selected = this.#listed.get(id) ?? null
    return this.#selected !== null
  }

  /**
   * For session.setDisplayMediaRequestHandler: the selected source, used once. On Wayland the
   * portal's choice. Anything else is refused.
   */
  async take(): Promise<DesktopSource | null> {
    if (this.usesSystemPicker) {
      const [source] = await this.options.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false,
      })
      return source ?? null
    }
    const source = this.#selected
    this.#selected = null
    return source
  }
}

function toCaptureSource(source: DesktopSource): CaptureSource {
  return {
    id: source.id,
    name: source.name,
    kind: source.id.startsWith('screen:') ? 'screen' : 'window',
    thumbnail: source.thumbnail.isEmpty() ? '' : source.thumbnail.toDataURL(),
    icon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
  }
}
