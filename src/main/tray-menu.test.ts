import { describe, expect, it, vi } from 'vitest'
import { trayMenuTemplate, trayTooltip, type TrayState } from './tray-menu'

const actions = () => ({
  open: vi.fn(),
  toggleMute: vi.fn(),
  toggleDeafen: vi.fn(),
  leaveCall: vi.fn(),
  setCloseToTray: vi.fn(),
  quit: vi.fn(),
})
const idle: TrayState = {
  inCall: false,
  roomName: '',
  muted: false,
  deafened: false,
  closeToTray: true,
}
const labels = (state: TrayState) =>
  trayMenuTemplate(state, actions()).map((item) => item.label ?? item.type)

describe('tray menu (#44)', () => {
  it('opens the window, toggles closing to the tray and quits when not in a call', () => {
    expect(labels(idle)).toEqual([
      'Открыть Tolki',
      'separator',
      'Сворачивать в трей при закрытии',
      'Выйти из Tolki',
    ])
  })

  it('offers the microphone, the sound and leaving during a call, as they are now', () => {
    expect(labels({ ...idle, inCall: true, roomName: 'Кино', muted: true })).toEqual([
      'Открыть Tolki',
      'separator',
      'В комнате: Кино',
      'Включить микрофон',
      'Выключить звук',
      'Выйти из комнаты',
      'separator',
      'Сворачивать в трей при закрытии',
      'Выйти из Tolki',
    ])
  })

  it('wires the items to the actions', () => {
    const a = actions()
    const menu = trayMenuTemplate({ ...idle, inCall: true, roomName: 'Кино' }, a)
    const click = (label: string, item: object = {}) => {
      ;(menu.find((m) => m.label === label)?.click as unknown as (i: object) => void)(item)
    }
    click('Выключить микрофон')
    click('Выйти из комнаты')
    click('Сворачивать в трей при закрытии', { checked: false })
    click('Выйти из Tolki')
    expect(a.toggleMute).toHaveBeenCalled()
    expect(a.leaveCall).toHaveBeenCalled()
    expect(a.setCloseToTray).toHaveBeenCalledWith(false)
    expect(a.quit).toHaveBeenCalled()
  })

  it('names the call in the tooltip', () => {
    expect(trayTooltip({ inCall: true, roomName: 'Кино' })).toBe('Tolki — в комнате: Кино')
    expect(trayTooltip({ inCall: false, roomName: '' })).toBe('Tolki')
  })
})
