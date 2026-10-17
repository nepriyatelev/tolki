import { execFile } from 'node:child_process'
import { createSocket } from 'node:dgram'
import { readFile } from 'node:fs/promises'
import { isIPv4 } from 'node:net'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface DefaultGateway {
  /** IPv4 address of the router (PCP / NAT-PMP server). */
  gateway: string
  /** Our IPv4 address on the interface that faces the gateway. */
  localAddress: string
}

/** Finds the IPv4 default gateway without third-party tools. Returns null if there is none. */
export async function findDefaultGateway(): Promise<DefaultGateway | null> {
  let gateway: string | null
  try {
    gateway = await readGateway()
  } catch {
    return null
  }
  if (gateway === null) return null
  const localAddress = await localAddressTowards(gateway)
  return localAddress === null ? null : { gateway, localAddress }
}

async function readGateway(): Promise<string | null> {
  switch (process.platform) {
    case 'linux':
      return parseLinuxRouteTable(await readFile('/proc/net/route', 'utf8'))
    case 'darwin':
      return parseMacRouteGet((await execFileAsync('/sbin/route', ['-n', 'get', 'default'])).stdout)
    case 'win32':
      return parseWindowsRoutePrint(
        (await execFileAsync('route', ['print', '-4', '0.0.0.0'], { windowsHide: true })).stdout,
      )
    default:
      return null
  }
}

/** /proc/net/route: default route has Destination 00000000; Gateway is little-endian hex. */
export function parseLinuxRouteTable(table: string): string | null {
  let best: { gateway: string; metric: number } | null = null
  for (const line of table.split('\n').slice(1)) {
    const [, destination, gatewayHex, flags, , , metric] = line.trim().split(/\s+/)
    if (destination !== '00000000' || gatewayHex === undefined || flags === undefined) continue
    // RTF_UP (0x1) and RTF_GATEWAY (0x2) must be set.
    if ((parseInt(flags, 16) & 0x3) !== 0x3) continue
    const bytes = gatewayHex.match(/../g)?.map((b) => parseInt(b, 16))
    if (bytes?.length !== 4) continue
    const gateway = bytes.reverse().join('.')
    const m = Number(metric ?? 0)
    if (best === null || m < best.metric) best = { gateway, metric: m }
  }
  return best?.gateway ?? null
}

/** `route -n get default` prints "gateway: 192.168.1.1". */
export function parseMacRouteGet(output: string): string | null {
  const match = /^\s*gateway:\s*(\S+)/m.exec(output)
  const gateway = match?.[1]
  return gateway !== undefined && isIPv4(gateway) ? gateway : null
}

/** `route print -4 0.0.0.0`: rows "0.0.0.0  0.0.0.0  <gateway>  <interface>  <metric>". */
export function parseWindowsRoutePrint(output: string): string | null {
  let best: { gateway: string; metric: number } | null = null
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\S+)\s+\S+\s+(\d+)\s*$/.exec(line)
    const gateway = match?.[1]
    if (gateway === undefined || !isIPv4(gateway)) continue // skips "On-link"
    const metric = Number(match?.[2])
    if (best === null || metric < best.metric) best = { gateway, metric }
  }
  return best?.gateway ?? null
}

/** A connected UDP socket reveals the source address the OS would use; nothing is sent. */
function localAddressTowards(gateway: string): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = createSocket('udp4')
    socket.once('error', () => {
      socket.close()
      resolve(null)
    })
    socket.connect(5351, gateway, () => {
      const { address } = socket.address()
      socket.close()
      resolve(address)
    })
  })
}
