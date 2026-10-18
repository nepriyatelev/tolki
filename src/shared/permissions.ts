/** What the OS asks the user for (#85): the microphone, and on macOS «Запись экрана». */
export type PermissionKind = 'microphone' | 'screen'
export const PERMISSION_KINDS = ['microphone', 'screen'] as const

/**
 * - `not-asked`: the system dialog has not been shown yet (macOS); explain first, then ask.
 * - `denied`: only the user can allow it, in the system settings.
 * - `restart-needed`: macOS applies «Запись экрана» only when Tolki starts again.
 */
export type PermissionState = 'not-asked' | 'granted' | 'denied' | 'restart-needed'
