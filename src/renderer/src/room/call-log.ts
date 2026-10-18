import type { ConnectionSample, ScreenSample } from './call'

/** How often the call's numbers go into the logs (#106): enough to see a problem, not chatty. */
export const CALL_LOG_INTERVAL_MS = 30_000

/**
 * One line for the logs about the link and the screen since the previous line; main writes the
 * window's console.info to renderer.log. Loss and bitrate come from two samples.
 */
export function callLogLine(
  link: { now: ConnectionSample | null; before: ConnectionSample | null },
  screen: { now: ScreenSample | null; before: ScreenSample | null; own: boolean } | null,
): string {
  const parts: string[] = []
  const { now, before } = link
  if (now) {
    const received = now.packetsReceived - (before?.packetsReceived ?? 0)
    const lost = now.packetsLost - (before?.packetsLost ?? 0)
    const loss = received + lost > 0 ? (lost / (received + lost)) * 100 : 0
    parts.push(
      `link ${now.rttMs ?? '?'} ms over ${now.protocol?.toUpperCase() ?? '?'}, loss ${loss.toFixed(1)} %`,
    )
  } else {
    parts.push('link: no numbers yet')
  }
  if (screen?.now) {
    const s = screen.now
    const seconds = screen.before ? (s.timestamp - screen.before.timestamp) / 1000 : 0
    const mbps = seconds > 0 ? ((s.bytes - (screen.before?.bytes ?? 0)) * 8) / seconds / 1e6 : 0
    parts.push(
      `${screen.own ? 'sending' : 'watching'} screen ${s.height}p ${s.fps} fps ${mbps.toFixed(1)} Mbit/s` +
        (s.encoder ? `, encoder ${s.encoder}` : ''),
    )
  }
  return `[call] ${parts.join('; ')}`
}
