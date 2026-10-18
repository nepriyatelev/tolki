import { describe, expect, it, vi } from 'vitest'
import type { PermissionKind } from '@shared/permissions'
import { Permissions, settingsUrl, type PermissionsOptions } from './permissions'

function permissions(
  platform: NodeJS.Platform,
  statuses: Partial<Record<PermissionKind, string>>,
  extra: Partial<PermissionsOptions> = {},
) {
  const current = { microphone: 'granted', screen: 'granted', ...statuses }
  const ask = vi.fn(() => {
    current.microphone = 'granted'
    return Promise.resolve(true)
  })
  const openUrl = vi.fn(() => Promise.resolve())
  const subject = new Permissions({
    platform,
    status: (kind) => current[kind],
    ask,
    openUrl,
    ...extra,
  })
  // As main does once the app is ready.
  subject.start()
  return { subject, current, ask, openUrl }
}

describe('Permissions (#85)', () => {
  it('macOS: not asked yet, allowed, denied', () => {
    expect(
      permissions('darwin', { microphone: 'not-determined' }).subject.status('microphone'),
    ).toBe('not-asked')
    expect(permissions('darwin', {}).subject.status('microphone')).toBe('granted')
    expect(permissions('darwin', { microphone: 'denied' }).subject.status('microphone')).toBe(
      'denied',
    )
    expect(permissions('darwin', { screen: 'restricted' }).subject.status('screen')).toBe('denied')
  })

  it('asks for the microphone on macOS only when it was not asked', async () => {
    const asked = permissions('darwin', { microphone: 'not-determined' })
    expect(await asked.subject.request('microphone')).toBe('granted')
    expect(asked.ask).toHaveBeenCalledOnce()
    const denied = permissions('darwin', { microphone: 'denied' })
    expect(await denied.subject.request('microphone')).toBe('denied')
    expect(denied.ask).not.toHaveBeenCalled()
  })

  it('macOS needs a restart for «Запись экрана» allowed while Tolki runs', async () => {
    const granted = permissions('darwin', { screen: 'denied' })
    granted.current.screen = 'granted'
    expect(granted.subject.status('screen')).toBe('restart-needed')

    // The status may not change until a restart: having gone to the settings is enough.
    const opened = permissions('darwin', { screen: 'denied' })
    await opened.subject.openSettings('screen')
    expect(opened.openUrl).toHaveBeenCalledWith(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    )
    expect(opened.subject.status('screen')).toBe('restart-needed')

    expect(permissions('darwin', {}).subject.status('screen')).toBe('granted')
  })

  it('Windows: the microphone switch in privacy settings; no screen permission', async () => {
    const win = permissions('win32', { microphone: 'denied', screen: 'denied' })
    expect(win.subject.status('microphone')).toBe('denied')
    expect(win.subject.status('screen')).toBe('granted')
    await win.subject.openSettings('microphone')
    expect(win.openUrl).toHaveBeenCalledWith('ms-settings:privacy-microphone')
    expect(await win.subject.request('microphone')).toBe('denied')
    expect(win.ask).not.toHaveBeenCalled()
  })

  it('Linux and e2e: nothing to ask', () => {
    expect(permissions('linux', { microphone: 'denied' }).subject.status('microphone')).toBe(
      'granted',
    )
    const skipped = permissions(
      'darwin',
      { screen: 'not-determined', microphone: 'denied' },
      { skip: true },
    )
    expect(skipped.subject.status('screen')).toBe('granted')
    // A real refusal is not hidden: tests that need the screen skip themselves on it.
    expect(skipped.subject.status('microphone')).toBe('denied')
    expect(settingsUrl('linux', 'microphone')).toBeNull()
  })
})
