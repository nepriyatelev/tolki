import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
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
    expect(b.written).toEqual([{ speedTest: { enabled: false } }])
  })

  it('hands out copies, so callers cannot mutate the stored settings', () => {
    const store = new SettingsStore(backend({}))

    store.get().speedTest.enabled = false

    expect(store.get().speedTest.enabled).toBe(true)
  })
})
