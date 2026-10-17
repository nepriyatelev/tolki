/**
 * Voice settings (PLAN #25): Opus at 48 kHz, mono, about 40 kbit/s, with DTX (nothing is sent
 * in silence) and in-band FEC (a lost packet can be rebuilt from the next one).
 */
export const VOICE = {
  sampleRate: 48_000,
  channels: 1,
  /** Bits per second; the plan asks for 32–48 kbit/s. */
  maxAverageBitrate: 40_000,
  /** Milliseconds of audio per packet. */
  ptime: 20,
  dtx: true,
  fec: true,
} as const

/** Opus fmtp parameters the router announces, so both sides agree on the voice settings. */
export const VOICE_OPUS_PARAMETERS = {
  useinbandfec: 1,
  usedtx: 1,
  stereo: 0,
  'sprop-stereo': 0,
} as const
