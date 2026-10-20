import type { UpdateOffer } from '@shared/ipc'
import type { Logger } from './logging'

/** What we use of electron-updater's AppUpdater, so tests can drive it. */
export interface Updater {
  on(event: 'update-downloaded', listener: (info: { version: string }) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

/** An updater whose feed can be pointed at one release (electron-updater's setFeedURL). */
export interface FeedUpdater extends Updater {
  setFeedURL(options: { provider: 'generic'; url: string }): void
}

/** Where a release's installers and latest*.yml are, by its version. */
export function releaseFeedUrl(version: string): string {
  return `https://github.com/nepriyatelev/tolki/releases/download/v${version}`
}

/**
 * The updater downloads the version our own check found, from that release (#46). electron-updater
 * on its own takes a pre-release's «rc» for a channel of its own: a 0.1.0-rc.1 would then get
 * the next rc but never 0.1.0. Our check knows a pre-release looks at both.
 */
export function pinToRelease(
  updater: FeedUpdater,
  newer: () => Promise<{ version: string } | null>,
  feedUrl: (version: string) => string = releaseFeedUrl,
): Updater {
  return {
    on: updater.on.bind(updater),
    quitAndInstall: updater.quitAndInstall.bind(updater),
    checkForUpdates: async () => {
      const latest = await newer()
      if (!latest) return null
      updater.setFeedURL({ provider: 'generic', url: feedUrl(latest.version) })
      return updater.checkForUpdates()
    },
  }
}

export interface AutoUpdateOptions {
  /**
   * electron-updater where it can install by itself (Windows NSIS, Linux AppImage; #46); null
   * elsewhere (macOS without a Developer ID, .deb) and when updates are off.
   */
  updater: Updater | null
  /** «Доступна версия X» with a download page (#36): without an updater, or when it fails. */
  fallback: () => Promise<{ version: string } | null>
  onChange: (offer: UpdateOffer) => void
  log: Logger
}

/**
 * Updates (#46): where possible the new version downloads in the background and installs when
 * Tolki quits (or at once by «Перезапустить»); elsewhere the banner leads to the download page.
 */
export class AutoUpdate {
  #offer: UpdateOffer = null
  #started: Promise<void> | null = null

  constructor(private readonly options: AutoUpdateOptions) {}

  /** What to offer now; the first call starts the check. */
  async offer(): Promise<UpdateOffer> {
    this.#started ??= this.#start()
    await this.#started
    return this.#offer
  }

  /** «Перезапустить»: only once the new version is downloaded. */
  install(): boolean {
    if (!this.#offer?.ready || !this.options.updater) return false
    this.options.log.info(`installing ${this.#offer.version}`)
    // Silent (the installer has nothing to ask), and Tolki starts again after it.
    this.options.updater.quitAndInstall(true, true)
    return true
  }

  async #start(): Promise<void> {
    const { updater, log } = this.options
    if (!updater) {
      await this.#useFallback()
      return
    }
    updater.on('update-downloaded', ({ version }) => {
      log.info(`update ${version} downloaded, installs on quit`)
      this.#set({ version, ready: true })
    })
    updater.on('error', (error) => {
      log.warn(`auto-update failed: ${error.message}`)
      // Not downloaded after all: the page with installers is still there.
      if (!this.#offer?.ready) void this.#useFallback()
    })
    // Whether there is anything new comes by the events; the check itself only starts it.
    await updater.checkForUpdates().catch(() => undefined)
  }

  async #useFallback(): Promise<void> {
    const latest = await this.options.fallback().catch(() => null)
    if (latest && !this.#offer?.ready) this.#set({ version: latest.version, ready: false })
  }

  #set(offer: UpdateOffer): void {
    this.#offer = offer
    this.options.onChange(offer)
  }
}
