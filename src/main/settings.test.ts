import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, settingsPatchSchema, type Settings } from '@shared/settings'
import { SettingsStore } from './settings'

function backend(initial: unknown) {
  const written: Settings[] = []
  return { read: () => initial, write: (s: Settings) => written.push(s), written }
}

describe('SettingsStore', () => {
  it('starts from defaults: the speed test is on', () => {
    expect(new SettingsStore(backend({})).get()).toEqual(DEFAULT_SETTINGS)
    expect(DEFAULT_SETTINGS.speedTest.enabled).toBe(true)
  })

  it('loads valid stored settings', () => {
    const store = new SettingsStore(backend({ speedTest: { enabled: false } }))

    expect(store.get().speedTest.enabled).toBe(false)
  })

  it('falls back to defaults for garbage', () => {
    const store = new SettingsStore(backend({ speedTest: { enabled: 'yes' } }))

    expect(store.get()).toEqual(DEFAULT_SETTINGS)
  })

  it('applies a patch and persists it', () => {
    const b = backend({})
    const store = new SettingsStore(b)

    expect(store.update({ speedTest: { enabled: false } }).speedTest.enabled).toBe(false)
    expect(b.written).toEqual([
      {
        speedTest: { enabled: false },
        profile: { name: '' },
        audio: { inputDeviceId: '', peerVolumes: {} },
      },
    ])
  })

  it('keeps choices saved by an older version that had no profile yet', () => {
    const store = new SettingsStore(backend({ speedTest: { enabled: false } }))

    expect(store.get()).toEqual({
      speedTest: { enabled: false },
      profile: { name: '' },
      audio: { inputDeviceId: '', peerVolumes: {} },
    })
  })

  it('remembers the profile name', () => {
    const store = new SettingsStore(backend({}))

    expect(store.update({ profile: { name: 'Алексей' } }).profile.name).toBe('Алексей')
    expect(store.get().speedTest.enabled).toBe(true)
  })

  it('hands out copies, so callers cannot mutate the stored settings', () => {
    const store = new SettingsStore(backend({}))

    store.get().speedTest.enabled = false

    expect(store.get().speedTest.enabled).toBe(true)
  })

  it('remembers volumes by name, forgets 100 % and keeps the microphone choice', () => {
    const store = new SettingsStore(
      backend({ audio: { inputDeviceId: 'mic', peerVolumes: { миша: 50 } } }),
    )

    store.update({ audio: { peerVolumes: { '  Катя ': 150 } } })
    expect(store.get().audio).toEqual({
      inputDeviceId: 'mic',
      peerVolumes: { миша: 50, катя: 150 },
    })

    store.update({ audio: { peerVolumes: { Миша: 100 } } })
    expect(store.get().audio.peerVolumes).toEqual({ катя: 150 })
  })

  it('keeps at most 200 remembered volumes, dropping the oldest', () => {
    const store = new SettingsStore(backend({}))
    for (let i = 0; i < 205; i++) store.update({ audio: { peerVolumes: { [`друг ${i}`]: 120 } } })

    const names = Object.keys(store.get().audio.peerVolumes)
    expect(names).toHaveLength(200)
    expect(names[0]).toBe('друг 5')
  })

  it('rejects volumes out of range', () => {
    expect(settingsPatchSchema.safeParse({ audio: { peerVolumes: { a: 201 } } }).success).toBe(
      false,
    )
    expect(settingsPatchSchema.safeParse({ audio: { peerVolumes: { a: -1 } } }).success).toBe(false)
  })
})
