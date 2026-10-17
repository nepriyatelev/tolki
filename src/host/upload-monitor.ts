import { estimateCapacity, type UploadCapacity } from '@shared/upload-capacity'
import type { MediaTransport } from './media-server'

/** The bits of mediasoup's transport stats the estimate needs. */
export interface OutgoingStats {
  /** What the host sends on this transport right now, bit/s. */
  sendBitrate: number
  /** Bandwidth estimate towards this participant, bit/s. */
  availableOutgoingBitrate?: number
}

/**
 * Host upload during a call (PLAN #10), from mediasoup's statistics. It is a lower bound: the
 * upload carries at least everything sent at once, and at least the best path estimate to any
 * one participant. Null while nothing is being sent.
 */
export function uploadFromStats(stats: OutgoingStats[]): number | null {
  const sending = stats.reduce((sum, s) => sum + s.sendBitrate, 0)
  const bestPath = Math.max(0, ...stats.map((s) => s.availableOutgoingBitrate ?? 0))
  const bps = Math.max(sending, bestPath)
  return bps > 0 ? bps / 1_000_000 : null
}

/** Polls the receive transports (host → participants) and reports the estimated capacity. */
export function monitorUpload(
  transports: () => MediaTransport[],
  report: (capacity: UploadCapacity) => void,
  intervalMs = 5000,
): () => void {
  const timer = setInterval(() => {
    const outgoing = transports().filter((t) => t.appData.direction === 'recv')
    void Promise.all(outgoing.map((t) => t.getStats().catch(() => []))).then((all) => {
      const mbps = uploadFromStats(all.flat())
      if (mbps !== null) report(estimateCapacity(mbps))
    })
  }, intervalMs)
  timer.unref()
  return () => {
    clearInterval(timer)
  }
}
