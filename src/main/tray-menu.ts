import type { MenuItemConstructorOptions } from 'electron'

/** What the tray menu shows (PLAN #44): the call, if any, and the closing behaviour. */
export interface TrayState {
  inCall: boolean
  roomName: string
  muted: boolean
  deafened: boolean
  /** Closing the window hides it to the tray instead of quitting. */
  closeToTray: boolean
}

export interface TrayActions {
  open: () => void
  toggleMute: () => void
  toggleDeafen: () => void
  leaveCall: () => void
  setCloseToTray: (enabled: boolean) => void
  quit: () => void
}

/** «Открыть Tolki», the call's microphone, sound and leaving, closing to the tray, quitting. */
export function trayMenuTemplate(
  state: TrayState,
  actions: TrayActions,
): MenuItemConstructorOptions[] {
  const call: MenuItemConstructorOptions[] = state.inCall
    ? [
        { type: 'separator' },
        { label: `В комнате: ${state.roomName}`, enabled: false },
        {
          label: state.muted ? 'Включить микрофон' : 'Выключить микрофон',
          click: actions.toggleMute,
        },
        { label: state.deafened ? 'Включить звук' : 'Выключить звук', click: actions.toggleDeafen },
        { label: 'Выйти из комнаты', click: actions.leaveCall },
      ]
    : []
  return [
    { label: 'Открыть Tolki', click: actions.open },
    ...call,
    { type: 'separator' },
    {
      label: 'Сворачивать в трей при закрытии',
      type: 'checkbox',
      checked: state.closeToTray,
      click: (item) => {
        actions.setCloseToTray(item.checked)
      },
    },
    { label: 'Выйти из Tolki', click: actions.quit },
  ]
}

/** «Tolki — в комнате: Кино», for the tray icon's tooltip. */
export function trayTooltip(state: Pick<TrayState, 'inCall' | 'roomName'>): string {
  return state.inCall ? `Tolki — в комнате: ${state.roomName}` : 'Tolki'
}
