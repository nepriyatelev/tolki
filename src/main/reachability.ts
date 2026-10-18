import { createServer, type Server } from 'node:net'

/** Whether the port answers from the internet (#128). */
export type Reachability = 'reachable' | 'closed' | 'unknown'

/** A public port checker (owner's choice, #128): it learns only our address and the port. */
export const PORT_CHECK_API = 'https://ifconfig.co'

export interface ReachabilityOptions {
  port: number
  /** The room already listens on the port: no stand-in listener needed. */
  roomListening: boolean
  fetch: (url: string, init: RequestInit) => Promise<Response>
  api?: string
  timeoutMs?: number
  /** Tests pass their own listener. */
  listen?: (port: number) => Promise<Server>
}

/**
 * Asks the port checker to connect to this computer's address and port. Before a room is open
 * nothing listens there, so a plain TCP listener stands in for it while the checker knocks.
 * Never throws: any failure is `unknown`.
 */
export async function checkReachability(options: ReachabilityOptions): Promise<Reachability> {
  let server: Server | null = null
  try {
    if (!options.roomListening) {
      server = await (options.listen ?? listenOn)(options.port)
    }
    const response = await options.fetch(`${options.api ?? PORT_CHECK_API}/port/${options.port}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    })
    if (!response.ok) return 'unknown'
    const { reachable } = (await response.json()) as { reachable?: unknown }
    return reachable === true ? 'reachable' : reachable === false ? 'closed' : 'unknown'
  } catch {
    return 'unknown'
  } finally {
    server?.close()
  }
}

/** Accepts and drops connections: the checker only needs the connection to succeed. */
function listenOn(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => socket.destroy())
    server.once('error', reject)
    server.listen(port, () => {
      server.off('error', reject)
      resolve(server)
    })
  })
}
