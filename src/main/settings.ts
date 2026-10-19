import {
  DEFAULT_SETTINGS,
  MAX_REMEMBERED_VOLUMES,
  settingsSchema,
  volumeKey,
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
      ...(patch.profile ? { profile: { ...this.#settings.profile, ...patch.profile } } : {}),
      ...(patch.audio ? { audio: mergeAudio(this.#settings.audio, patch.audio) } : {}),
      ...(patch.pushToTalk
        ? {
            pushToTalk: {
              enabled: patch.pushToTalk.enabled ?? this.#settings.pushToTalk.enabled,
              key: patch.pushToTalk.key ?? this.#settings.pushToTalk.key,
            },
          }
        : {}),
      ...(patch.sounds ? { sounds: { ...this.#settings.sounds, ...patch.sounds } } : {}),
      ...(patch.tray
        ? {
            tray: {
              closeToTray: patch.tray.closeToTray ?? this.#settings.tray.closeToTray,
              hintShown: patch.tray.hintShown ?? this.#settings.tray.hintShown,
            },
          }
        : {}),
      ...(patch.screen ? { screen: { ...this.#settings.screen, ...patch.screen } } : {}),
      ...(patch.hints ? { hints: { ...this.#settings.hints, ...patch.hints } } : {}),
      ...(patch.globalHotkeys
        ? {
            globalHotkeys: {
              mute: patch.globalHotkeys.mute ?? this.#settings.globalHotkeys.mute,
              deafen: patch.globalHotkeys.deafen ?? this.#settings.globalHotkeys.deafen,
            },
          }
        : {}),
    }
    this.backend.write(this.#settings)
    return this.get()
  }
}

function mergeAudio(
  current: Settings['audio'],
  patch: NonNullable<SettingsPatch['audio']>,
): Settings['audio'] {
  const volumes = new Map(Object.entries(current.peerVolumes))
  for (const [name, volume] of Object.entries(patch.peerVolumes ?? {})) {
    const key = volumeKey(name)
    // Re-inserting moves the entry to the end: the oldest are dropped first.
    volumes.delete(key)
    if (volume !== 100) volumes.set(key, volume)
  }
  const kept = [...volumes].slice(-MAX_REMEMBERED_VOLUMES)
  return {
    inputDeviceId: patch.inputDeviceId ?? current.inputDeviceId,
    outputDeviceId: patch.outputDeviceId ?? current.outputDeviceId,
    peerVolumes: Object.fromEntries(kept),
  }
}
