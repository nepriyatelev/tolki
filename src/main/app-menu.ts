import type { MenuItemConstructorOptions } from 'electron'

export const SAVE_LOGS_ITEM_ID = 'save-logs'

/**
 * The standard menus (copy and paste live there) plus «Помощь → Сохранить логи…» (#106) — the
 * only way to the logs, like «Help → Debug log» in Signal Desktop.
 */
export function appMenuTemplate(options: {
  platform: NodeJS.Platform
  onSaveLogs: () => void
}): MenuItemConstructorOptions[] {
  return [
    ...(options.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      label: 'Помощь',
      submenu: [
        {
          id: SAVE_LOGS_ITEM_ID,
          label: 'Сохранить логи…',
          click: () => {
            options.onSaveLogs()
          },
        },
      ],
    },
  ]
}
