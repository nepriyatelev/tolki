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
  /** Our own picker with previews; `systemAudio`: the computer's sound can go along (#41). */
  | { picker: 'app'; sources: CaptureSource[]; systemAudio: boolean }
  /** Linux Wayland: the system portal (PipeWire) asks the user itself. */
  | { picker: 'system' }
  /** macOS: «Запись экрана» is not allowed for the app. */
  | { picker: 'denied' }
  /** macOS: allowed (or being allowed) since Tolki started; it takes effect after a restart (#85). */
  | { picker: 'restart' }

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

/**
 * Whether the computer's sound can go along with a shared screen (PLAN #41): Windows (WASAPI
 * loopback), macOS from 14.2 (Darwin 23.2, CoreAudio taps).
 *
 * Linux: no (#112). Electron's `loopback` there (Chromium's PulseaudioLoopbackForScreenShare)
 * records the whole speaker monitor, the call's voices too, and `restrictOwnAudio` /
 * `loopbackWithoutChrome` exist only on Windows and macOS: everyone would hear themselves with
 * a delay. What it would take: Chromium excluding its own streams on Linux (PipeWire, as
 * Vesktop does by hand with the native @vencord/venmic, which the owner chose not to add).
 */
export function systemAudioSupported(platform: string, osRelease: string): boolean {
  if (platform === 'win32') return true
  if (platform !== 'darwin') return false
  const [major = 0, minor = 0] = osRelease.split('.').map(Number)
  return major > 23 || (major === 23 && minor >= 2)
}

/** Opus for the computer's sound: music and films, not a voice — stereo and more bits. */
export const SCREEN_AUDIO = { stereo: true, maxAverageBitrate: 128_000 } as const
