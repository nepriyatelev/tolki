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

/** How a room shares screens, chosen when it is created (PLAN #16, #27). */
export const SCREEN_MODES = ['auto', 'text', 'motion'] as const
export type ScreenMode = (typeof SCREEN_MODES)[number]

export interface ScreenEncoding {
  /** MediaStreamTrack.contentHint: what the encoder should keep. */
  contentHint: '' | 'detail' | 'motion'
  /** Frames per second of the full layer. */
  frameRate: number
  /** Bits per second of the ≈1080p layer. */
  maxBitrate: number
}

/** The two simulcast layers (PLAN §2): ≈1080p for big windows, ≈360p for small or slow ones. */
export const SCREEN_LAYERS = { high: 1080, low: 360 } as const
export const LOW_LAYER_BITRATE = 500_000
/** The low layer never needs more frames than this. */
export const LOW_LAYER_MAX_FPS = 15

export const SCREEN_ENCODING: Record<ScreenMode, ScreenEncoding> = {
  /** The browser decides between sharpness and smoothness. */
  auto: { contentHint: '', frameRate: 30, maxBitrate: 2_500_000 },
  /** Code and documents: every letter sharp, few frames. */
  text: { contentHint: 'detail', frameRate: 15, maxBitrate: 1_500_000 },
  /** Games and video: smooth, up to 60 frames. */
  motion: { contentHint: 'motion', frameRate: 60, maxBitrate: 2_800_000 },
}

/** Simulcast encodings for a captured screen of the given height. */
export function screenEncodings(
  mode: ScreenMode,
  height: number,
): { rid: string; scaleResolutionDownBy: number; maxBitrate: number; maxFramerate: number }[] {
  const { frameRate, maxBitrate } = SCREEN_ENCODING[mode]
  const scale = (target: number): number => Math.max(1, height / target)
  return [
    {
      rid: 'low',
      scaleResolutionDownBy: scale(SCREEN_LAYERS.low),
      maxBitrate: LOW_LAYER_BITRATE,
      maxFramerate: Math.min(frameRate, LOW_LAYER_MAX_FPS),
    },
    {
      rid: 'high',
      scaleResolutionDownBy: scale(SCREEN_LAYERS.high),
      maxBitrate,
      maxFramerate: frameRate,
    },
  ]
}
