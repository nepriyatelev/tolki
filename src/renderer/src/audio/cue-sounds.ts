/** Short cues in the call (PLAN #43): someone came, someone left, someone asks to be let in. */
export type Cue = 'join' | 'leave' | 'knock'

/** Notes of each cue (Hz): up for coming, down for leaving, a soft double for knocking. */
export const CUE_NOTES: Record<Cue, number[]> = {
  join: [523, 784],
  leave: [784, 523],
  knock: [659, 659],
}

const NOTE_S = 0.12
const GAP_S = 0.04
/** Quieter than the test sound: a cue, not an alarm. */
const LEVEL = 0.12

/** Plays a cue on the chosen output, synthesized: no sound files to ship. */
export async function playCue(cue: Cue, outputDeviceId: string): Promise<void> {
  const context = new AudioContext()
  try {
    await context.setSinkId(outputDeviceId).catch(() => undefined)
    const gain = context.createGain()
    gain.gain.value = 0
    gain.connect(context.destination)
    const start = context.currentTime + 0.02
    for (const [i, frequency] of CUE_NOTES[cue].entries()) {
      const at = start + i * (NOTE_S + GAP_S)
      const tone = context.createOscillator()
      tone.type = 'sine'
      tone.frequency.value = frequency
      tone.connect(gain)
      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(LEVEL, at + 0.015)
      gain.gain.linearRampToValueAtTime(0, at + NOTE_S)
      tone.start(at)
      tone.stop(at + NOTE_S + 0.01)
    }
    await new Promise((resolve) => setTimeout(resolve, (NOTE_S + GAP_S) * 2000 + 100))
  } finally {
    await context.close()
  }
}

/** Not a heap of cues when several people come at once: one at a time, the rest skipped. */
export function cueLimiter(
  play: (cue: Cue) => void,
  gapMs = 400,
  now: () => number = Date.now,
): (cue: Cue) => void {
  let last = -Infinity
  return (cue) => {
    if (now() - last < gapMs) return
    last = now()
    play(cue)
  }
}
