import { createSocket } from 'node:dgram'
import { createServer, type AddressInfo } from 'node:net'

/**
 * A port free for both TCP and UDP: a room listens on both. Checking TCP alone is not enough —
 * the previous test's mediasoup worker may still hold the UDP port for a moment after its app
 * closed, and the room would not start.
 */
export async function freePort(): Promise<number> {
  for (;;) {
    const probe = createServer()
    await new Promise<void>((resolve) => {
      probe.listen(0, resolve)
    })
    const { port } = probe.address() as AddressInfo
    await new Promise<void>((resolve) => {
      probe.close(() => {
        resolve()
      })
    })
    // Dual-stack, like the room's own UDP socket.
    const udp = createSocket({ type: 'udp6', ipv6Only: false })
    const free = await new Promise<boolean>((resolve) => {
      udp.once('error', () => {
        resolve(false)
      })
      udp.bind(port, () => {
        resolve(true)
      })
    })
    udp.close()
    if (free) return port
  }
}
