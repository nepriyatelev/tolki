/**
 * How many people a host's upload can serve (PLAN §2 "Экономия трафика хоста").
 * The host's SFU sends every participant up to 3 voices and, during screen sharing,
 * one simulcast layer of the screen. Numbers are per receiving participant.
 */

export const MAX_PARTICIPANTS = 15

/** 3 loudest voices × ~50 kbit/s (Opus 32–48 kbit/s + RTP/SRTP/UDP overhead). */
export const VOICE_KBPS_PER_VIEWER = 150

/** Screen layer bitrates; 1080p matches the plan's "≈40 Mbit/s for 14 viewers". */
export const SCREEN_KBPS = { '1080p': 2800, '720p': 1500, '360p': 500 } as const
export type ScreenQuality = keyof typeof SCREEN_KBPS

/** Measured speed is a best case; keep a margin for other traffic and fluctuations. */
const USABLE_SHARE = 0.75

export interface UploadCapacity {
  uploadMbps: number
  /** Participants including the host that voice alone can serve, at most 15. */
  participants: number
  /** Best screen quality for a room of `participants`, or null if even 360p does not fit. */
  screen: ScreenQuality | null
}

export function estimateCapacity(uploadMbps: number): UploadCapacity {
  const usableKbps = Math.max(0, uploadMbps) * 1000 * USABLE_SHARE
  const participants = Math.min(
    MAX_PARTICIPANTS,
    1 + Math.floor(usableKbps / VOICE_KBPS_PER_VIEWER),
  )
  const viewers = participants - 1
  const screen =
    viewers === 0
      ? null
      : ((Object.keys(SCREEN_KBPS) as ScreenQuality[]).find(
          (q) => viewers * (VOICE_KBPS_PER_VIEWER + SCREEN_KBPS[q]) <= usableKbps,
        ) ?? null)
  return { uploadMbps, participants, screen }
}

export type UploadMeasurement =
  /** The user turned the speed test off. */
  | { status: 'disabled' }
  | { status: 'failed'; detail: string }
  | { status: 'measured'; mbps: number; measuredAt: number }
