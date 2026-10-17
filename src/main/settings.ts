import {
  DEFAULT_SETTINGS,
  settingsSchema,
  type Settings,
  type SettingsPatch,
} from '@shared/settings'

/** Where settings live; electron-store in the app, a plain object in tests. */
export interface SettingsBackend {
  read(): unknown
  write(settings: Settings): void
}

/** Validated settings: anything unreadable or from an older shape falls back to defaults. */
export class SettingsStore {
  #settings: Settings

  constructor(private readonly backend: SettingsBackend) {
    const parsed = settingsSchema.safeParse(backend.read())
    this.#settings = parsed.success ? parsed.data : structuredClone(DEFAULT_SETTINGS)
  }

  get(): Settings {
    return structuredClone(this.#settings)
  }

  update(patch: SettingsPatch): Settings {
    this.#settings = {
      ...this.#settings,
      ...(patch.speedTest
        ? { speedTest: { ...this.#settings.speedTest, ...patch.speedTest } }
        : {}),
    }
    this.backend.write(this.#settings)
    return this.get()
  }
}
