import type { WebSocket } from 'ws'

/**
 * WebSocket ping/pong (PLAN #31): a peer that misses a whole interval is gone — a laptop that
 * slept, a Wi-Fi that changed — and its socket is terminated, so 'close' fires within two
 * intervals instead of after TCP's minutes-long timeout.
 */
export function keepAlive(socket: WebSocket, intervalMs: number): void {
  let alive = true
  socket.on('pong', () => {
    alive = true
  })
  const timer = setInterval(() => {
    if (!alive) {
      socket.terminate()
      return
    }
    alive = false
    socket.ping()
  }, intervalMs)
  timer.unref()
  socket.once('close', () => {
    clearInterval(timer)
  })
}
