import { createServer, type Server } from 'node:net'

/**
 * Whether the port answers from the internet (#128). `busy`: another program holds the port,
 * so there is nothing of ours to knock on.
 */
export type Reachability = 'reachable' | 'closed' | 'unknown' | 'busy'

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
  /** Why the check went the way it did, for the logs; never this computer's address. */
  log?: (line: string) => void
}

/**
 * Asks the port checker to connect to this computer's address and port. Before a room is open
 * nothing listens there, so a plain TCP listener stands in for it while the checker knocks.
 * Never throws: any failure is `unknown`.
 */
export async function checkReachability(options: ReachabilityOptions): Promise<Reachability> {
  const log = options.log ?? (() => undefined)
  let server: Server | null = null
  if (!options.roomListening) {
    try {
      server = await (options.listen ?? listenOn)(options.port)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? 'error'
      log(`port check: cannot listen on port ${options.port} (${code})`)
      return code === 'EADDRINUSE' ? 'busy' : 'unknown'
    }
  }
  try {
    const response = await options.fetch(`${options.api ?? PORT_CHECK_API}/port/${options.port}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    })
    if (!response.ok) {
      log(`port check: the service answered HTTP ${response.status}`)
      return 'unknown'
    }
    const { reachable } = (await response.json()) as { reachable?: unknown }
    const result: Reachability =
      reachable === true ? 'reachable' : reachable === false ? 'closed' : 'unknown'
    log(
      result === 'unknown'
        ? 'port check: the service answered without «reachable»'
        : `port check: port ${options.port} ${result} from outside`,
    )
    return result
  } catch (error) {
    // The service's answer carries our address; its errors do not. Chromium's own code
    // (net::ERR_NAME_NOT_RESOLVED and the like) says the most.
    const name = error instanceof Error ? error.name : 'error'
    const code = error instanceof Error ? /net::ERR_[A-Z_]+/.exec(error.message)?.[0] : undefined
    log(
      name === 'TimeoutError' || name === 'AbortError'
        ? 'port check: the service did not answer in time'
        : `port check: the service is unreachable (${code ?? name})`,
    )
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
