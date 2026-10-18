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

/**
 * The screen's two streams (PLAN §2, #34): ≈1080p for big windows, ≈360p for small windows or
 * slow networks. Not simulcast: Chromium encodes simulcast H.264 in software only, and a single
 * ≈1080p stream gets the hardware encoder; the ≈360p one is cheap VP8.
 */
export const SCREEN_LAYERS = { high: 1080, low: 360 } as const
export const LOW_LAYER_BITRATE = 500_000
/** The ≈360p stream never needs more frames than this. */
export const LOW_LAYER_MAX_FPS = 15

export const SCREEN_ENCODING: Record<ScreenMode, ScreenEncoding> = {
  /** The browser decides between sharpness and smoothness. */
  auto: { contentHint: '', frameRate: 30, maxBitrate: 2_500_000 },
  /** Code and documents: every letter sharp, few frames. */
  text: { contentHint: 'detail', frameRate: 15, maxBitrate: 1_500_000 },
  /** Games and video: smooth, up to 60 frames. */
  motion: { contentHint: 'motion', frameRate: 60, maxBitrate: 2_800_000 },
}

export interface StreamEncoding {
  scaleResolutionDownBy: number
  maxBitrate: number
  maxFramerate: number
}

/** Encodings of the two streams for a captured screen of the given height. */
export function screenStreams(
  mode: ScreenMode,
  height: number,
): { high: StreamEncoding; low: StreamEncoding } {
  const { frameRate, maxBitrate } = SCREEN_ENCODING[mode]
  const scale = (target: number): number => Math.max(1, height / target)
  return {
    high: { scaleResolutionDownBy: scale(SCREEN_LAYERS.high), maxBitrate, maxFramerate: frameRate },
    low: {
      scaleResolutionDownBy: scale(SCREEN_LAYERS.low),
      maxBitrate: LOW_LAYER_BITRATE,
      maxFramerate: Math.min(frameRate, LOW_LAYER_MAX_FPS),
    },
  }
}
