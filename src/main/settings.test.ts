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
        audio: { inputDeviceId: '', outputDeviceId: '', peerVolumes: {} },
        pushToTalk: { enabled: false, key: 'Backquote' },
        globalHotkeys: { mute: '', deafen: '' },
      },
    ])
  })

  it('keeps choices saved by an older version that had no profile yet', () => {
    const store = new SettingsStore(backend({ speedTest: { enabled: false } }))

    expect(store.get()).toEqual({
      speedTest: { enabled: false },
      profile: { name: '' },
      audio: { inputDeviceId: '', outputDeviceId: '', peerVolumes: {} },
      pushToTalk: { enabled: false, key: 'Backquote' },
      globalHotkeys: { mute: '', deafen: '' },
    })
  })

  it('saves push-to-talk: on/off and the key, each on its own (#39)', () => {
    const store = new SettingsStore(backend({}))
    store.update({ pushToTalk: { enabled: true } })
    expect(store.update({ pushToTalk: { key: 'KeyV' } }).pushToTalk).toEqual({
      enabled: true,
      key: 'KeyV',
    })
  })

  it('saves global hotkeys one by one and clears them with an empty string (#40)', () => {
    const store = new SettingsStore(backend({}))
    store.update({ globalHotkeys: { mute: 'Control+Shift+M' } })
    expect(store.update({ globalHotkeys: { deafen: 'Alt+F9' } }).globalHotkeys).toEqual({
      mute: 'Control+Shift+M',
      deafen: 'Alt+F9',
    })
    expect(store.update({ globalHotkeys: { mute: '' } }).globalHotkeys.mute).toBe('')
    expect(settingsPatchSchema.safeParse({ globalHotkeys: { mute: 'M' } }).success).toBe(false)
  })

  it('takes only keys push-to-talk can use (#39)', () => {
    expect(settingsPatchSchema.safeParse({ pushToTalk: { key: 'KeyV' } }).success).toBe(true)
    expect(settingsPatchSchema.safeParse({ pushToTalk: { key: 'Escape' } }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ pushToTalk: { key: 'MediaPlay' } }).success).toBe(false)
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
      outputDeviceId: '',
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

  it('remembers the output device without touching the rest', () => {
    const store = new SettingsStore(backend({ audio: { inputDeviceId: 'mic' } }))

    store.update({ audio: { outputDeviceId: 'headphones' } })

    expect(store.get().audio).toEqual({
      inputDeviceId: 'mic',
      outputDeviceId: 'headphones',
      peerVolumes: {},
    })
  })

  it('rejects volumes out of range', () => {
    expect(settingsPatchSchema.safeParse({ audio: { peerVolumes: { a: 201 } } }).success).toBe(
      false,
    )
    expect(settingsPatchSchema.safeParse({ audio: { peerVolumes: { a: -1 } } }).success).toBe(false)
  })
})
