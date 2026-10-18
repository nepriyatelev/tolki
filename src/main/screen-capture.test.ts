import { describe, expect, it, vi } from 'vitest'
import { ScreenCapture, type DesktopSource, type ScreenCaptureOptions } from './screen-capture'

const image = (data: string) => ({ toDataURL: () => data, isEmpty: () => data === '' })

const SOURCES: DesktopSource[] = [
  { id: 'screen:1:0', name: 'Экран 1', thumbnail: image('data:screen'), appIcon: null },
  {
    id: 'window:42:0',
    name: 'Visual Studio Code',
    thumbnail: image('data:window'),
    appIcon: image('data:icon'),
  },
  { id: 'window:7:0', name: 'Пусто', thumbnail: image(''), appIcon: image('') },
]

function capture(options: Partial<ScreenCaptureOptions> = {}) {
  const getSources = vi.fn<ScreenCaptureOptions['getSources']>(({ types }) =>
    Promise.resolve(
      SOURCES.filter((s) => types.includes(s.id.startsWith('screen:') ? 'screen' : 'window')),
    ),
  )
  return {
    getSources,
    screen: new ScreenCapture({
      getSources,
      platform: 'win32',
      screenPermission: () => 'granted',
      env: {},
      systemAudio: true,
      ...options,
    }),
  }
}

describe('ScreenCapture', () => {
  it('lists screens and windows with previews and icons', async () => {
    const { screen, getSources } = capture()

    expect(await screen.list()).toEqual({
      picker: 'app',
      sources: [
        { id: 'screen:1:0', name: 'Экран 1', kind: 'screen', thumbnail: 'data:screen', icon: null },
        {
          id: 'window:42:0',
          name: 'Visual Studio Code',
          kind: 'window',
          thumbnail: 'data:window',
          icon: 'data:icon',
        },
        { id: 'window:7:0', name: 'Пусто', kind: 'window', thumbnail: '', icon: null },
      ],
      systemAudio: true,
    })
    expect(getSources).toHaveBeenCalledWith(expect.objectContaining({ types: ['screen'] }))
    expect(getSources).toHaveBeenCalledWith(
      expect.objectContaining({ types: ['window'], fetchWindowIcons: true }),
    )
  })

  it('offers the computer’s sound only where it works, never with the Wayland portal (#41)', async () => {
    expect(await capture({ systemAudio: false }).screen.list()).toMatchObject({
      systemAudio: false,
    })
    const wayland = capture({ platform: 'linux', env: { XDG_SESSION_TYPE: 'wayland' } })
    expect(wayland.screen.systemAudio).toBe(false)
  })

  it('still lists screens when windows cannot be listed', async () => {
    const { screen, getSources } = capture()
    getSources.mockImplementation(({ types }) =>
      types.includes('window')
        ? Promise.reject(new Error('no window manager'))
        : Promise.resolve(SOURCES.slice(0, 1)),
    )

    expect(await screen.list()).toMatchObject({
      picker: 'app',
      sources: [{ id: 'screen:1:0', kind: 'screen' }],
    })
  })

  it('hands getDisplayMedia only the source picked from the list, once', async () => {
    const { screen } = capture()
    expect(screen.select('window:42:0')).toBe(false) // nothing listed yet
    await screen.list()

    expect(screen.select('window:999:0')).toBe(false)
    expect(screen.select('window:42:0')).toBe(true)
    expect((await screen.take())?.id).toBe('window:42:0')
    expect(await screen.take()).toBeNull()
  })

  it('refuses when nothing was picked', async () => {
    const { screen } = capture()
    await screen.list()
    expect(await screen.take()).toBeNull()
  })

  it('leaves the choice to the desktop portal on Wayland', async () => {
    const { screen, getSources } = capture({
      platform: 'linux',
      env: { XDG_SESSION_TYPE: 'wayland' },
    })

    expect(await screen.list()).toEqual({ picker: 'system' })
    expect(getSources).not.toHaveBeenCalled()
    expect((await screen.take())?.id).toBe('screen:1:0')
  })

  it('uses its own picker on Linux X11', async () => {
    const { screen } = capture({ platform: 'linux', env: { XDG_SESSION_TYPE: 'x11' } })
    expect((await screen.list()).picker).toBe('app')
  })

  it('explains the missing «Запись экрана» permission on macOS', async () => {
    const { screen, getSources } = capture({ platform: 'darwin', screenPermission: () => 'denied' })
    expect(await screen.list()).toEqual({ picker: 'denied' })
    expect(getSources).not.toHaveBeenCalled()
  })

  it('offers a restart when the permission waits for one (#85)', async () => {
    const { screen, getSources } = capture({
      platform: 'darwin',
      screenPermission: () => 'restart-needed',
    })
    expect(await screen.list()).toEqual({ picker: 'restart' })
    expect(getSources).not.toHaveBeenCalled()
  })

  it('lets macOS ask for the permission the first time', async () => {
    const { screen } = capture({ platform: 'darwin', screenPermission: () => 'not-asked' })
    expect((await screen.list()).picker).toBe('app')
  })
})
