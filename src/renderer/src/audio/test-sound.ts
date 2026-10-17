/** A short two-note chime on the chosen output, so the user hears where the sound goes. */
export async function playTestSound(outputDeviceId: string): Promise<void> {
  const context = new AudioContext()
  try {
    await context.setSinkId(outputDeviceId)
    const gain = context.createGain()
    gain.connect(context.destination)
    const start = context.currentTime + 0.05
    for (const [i, frequency] of [660, 880].entries()) {
      const at = start + i * 0.25
      const tone = context.createOscillator()
      tone.frequency.value = frequency
      tone.connect(gain)
      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(0.25, at + 0.02)
      gain.gain.linearRampToValueAtTime(0, at + 0.22)
      tone.start(at)
      tone.stop(at + 0.24)
    }
    await new Promise((resolve) => setTimeout(resolve, 650))
  } finally {
    await context.close()
  }
}
