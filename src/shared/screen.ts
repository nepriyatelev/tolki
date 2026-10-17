/** A screen or window the user can show (PLAN #26). */
export interface CaptureSource {
  id: string
  name: string
  kind: 'screen' | 'window'
  /** PNG data URL of a small preview. */
  thumbnail: string
  /** The window's app icon, if the system gives one. */
  icon: string | null
}

export type ScreenSourcesResult =
  /** Our own picker with previews. */
  | { picker: 'app'; sources: CaptureSource[] }
  /** Linux Wayland: the system portal (PipeWire) asks the user itself. */
  | { picker: 'system' }
  /** macOS: «Запись экрана» is not allowed for the app. */
  | { picker: 'denied' }
