import { pmpNat, upnpNat, type Gateway } from '@achingbrain/nat-port-mapper'
import type { DefaultGateway } from './gateway'
import { newNonce, pcpMap, PcpError, type PcpProtocol } from './pcp'
import { MethodUnavailableError, type MappedPort, type MappingStrategy } from './port-mapper'

const LEASE_SECONDS = 2 * 60 * 60
const DESCRIPTION = 'Ratatosk'
const PROTOCOLS: readonly PcpProtocol[] = ['tcp', 'udp']

/** What the PCP attempt learned about port 5351, so NAT-PMP is skipped when nobody listens. */
export interface NatProbe {
  pcp?: 'no-response' | 'nat-pmp-only'
}

export class PcpStrategy implements MappingStrategy {
  readonly method = 'pcp'
  readonly #mapped = new Map<PcpProtocol, { nonce: Buffer; externalPort: number }>()
  #port = 0
  #renewTimer: NodeJS.Timeout | undefined

  constructor(
    private readonly gateway: DefaultGateway,
    private readonly probe: NatProbe,
    /** Tests point this at a fake PCP server. */
    private readonly serverPort?: number,
  ) {}

  async map(port: number): Promise<MappedPort> {
    this.#port = port
    let externalAddress = ''
    let lifetime = LEASE_SECONDS
    for (const protocol of PROTOCOLS) {
      const nonce = newNonce()
      try {
        const result = await this.#request(protocol, nonce, port, LEASE_SECONDS)
        this.#mapped.set(protocol, { nonce, externalPort: result.externalPort })
        externalAddress = result.externalAddress
        lifetime = Math.min(lifetime, result.lifetime)
      } catch (error) {
        if (
          error instanceof PcpError &&
          (error.code === 'no-response' || error.code === 'nat-pmp-only')
        ) {
          this.probe.pcp = error.code
          throw new MethodUnavailableError(error.message)
        }
        throw error
      }
    }
    this.#scheduleRenewal(lifetime)
    return {
      externalAddress,
      externalPort: this.#mapped.get('tcp')?.externalPort ?? port,
      externalUdpPort: this.#mapped.get('udp')?.externalPort ?? port,
    }
  }

  async close(): Promise<void> {
    clearTimeout(this.#renewTimer)
    // Lifetime 0 with the same nonce deletes a mapping; best effort with a short retry.
    await Promise.all(
      [...this.#mapped].map(([protocol, { nonce }]) =>
        this.#request(protocol, nonce, 0, 0, [300, 600]).catch(() => undefined),
      ),
    )
    this.#mapped.clear()
  }

  #request(
    protocol: PcpProtocol,
    nonce: Buffer,
    suggestedExternalPort: number,
    lifetime: number,
    retryDelaysMs?: number[],
  ) {
    return pcpMap({
      gateway: this.gateway.gateway,
      localAddress: this.gateway.localAddress,
      protocol,
      internalPort: this.#port,
      suggestedExternalPort,
      lifetime,
      nonce,
      ...(retryDelaysMs ? { retryDelaysMs } : {}),
      ...(this.serverPort ? { serverPort: this.serverPort } : {}),
    })
  }

  /** Renews at half the granted lifetime, as RFC 6887 recommends. */
  #scheduleRenewal(lifetime: number): void {
    this.#renewTimer = setTimeout(
      () => {
        Promise.all(
          [...this.#mapped].map(([protocol, m]) =>
            this.#request(protocol, m.nonce, m.externalPort, LEASE_SECONDS),
          ),
        )
          .then((results) => {
            this.#scheduleRenewal(Math.min(...results.map((r) => r.lifetime)))
          })
          .catch((error: unknown) => {
            console.error('[host] PCP renewal failed:', error)
          })
      },
      Math.max(60, lifetime / 2) * 1000,
    )
    this.#renewTimer.unref()
  }
}

export class NatPmpStrategy implements MappingStrategy {
  readonly method = 'nat-pmp'
  #client: Gateway | null = null

  constructor(
    private readonly gateway: DefaultGateway,
    private readonly probe: NatProbe,
  ) {}

  async map(port: number): Promise<MappedPort> {
    // PCP and NAT-PMP share port 5351: if PCP got no answer at all, NAT-PMP will not either.
    if (this.probe.pcp !== 'nat-pmp-only') {
      throw new MethodUnavailableError('No NAT-PMP server on the gateway')
    }
    const client = pmpNat(this.gateway.gateway, {
      ttl: LEASE_SECONDS * 1000,
      autoRefresh: true,
      description: DESCRIPTION,
    })
    this.#client = client
    return mapWithGateway(client, port, this.gateway.localAddress)
  }

  async close(): Promise<void> {
    await this.#client?.stop({ signal: AbortSignal.timeout(2000) }).catch(() => undefined)
    this.#client = null
  }
}

export class UpnpStrategy implements MappingStrategy {
  readonly method = 'upnp'
  #gateway: Gateway | null = null

  constructor(
    private readonly localAddress: string | null,
    private readonly discoveryTimeoutMs = 5000,
  ) {}

  async map(port: number): Promise<MappedPort> {
    const client = upnpNat({
      ttl: LEASE_SECONDS * 1000,
      autoRefresh: true,
      description: DESCRIPTION,
    })
    try {
      for await (const gateway of client.findGateways({
        signal: AbortSignal.timeout(this.discoveryTimeoutMs),
      })) {
        if (gateway.family !== 'IPv4') continue
        this.#gateway = gateway
        break
      }
    } catch {
      // Discovery ends with an abort when the timeout fires.
    }
    if (!this.#gateway) throw new MethodUnavailableError('No UPnP gateway found')
    const localAddress = this.localAddress ?? (await localAddressFor(this.#gateway.host))
    return mapWithGateway(this.#gateway, port, localAddress)
  }

  async close(): Promise<void> {
    await this.#gateway?.stop({ signal: AbortSignal.timeout(3000) }).catch(() => undefined)
    this.#gateway = null
  }
}

async function mapWithGateway(
  gateway: Gateway,
  port: number,
  localAddress: string,
): Promise<MappedPort> {
  const options = {
    externalPort: port,
    description: DESCRIPTION,
    signal: AbortSignal.timeout(5000),
  }
  let tcp
  try {
    tcp = await gateway.map(port, localAddress, { ...options, protocol: 'TCP' })
  } catch (error) {
    if (isAbort(error))
      throw new MethodUnavailableError('Gateway did not answer the mapping request')
    throw error
  }
  const udp = await gateway.map(port, localAddress, { ...options, protocol: 'UDP' })
  const externalAddress =
    tcp.externalHost || (await gateway.externalIp({ signal: AbortSignal.timeout(5000) }))
  return { externalAddress, externalPort: tcp.externalPort, externalUdpPort: udp.externalPort }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

async function localAddressFor(host: string): Promise<string> {
  const { createSocket } = await import('node:dgram')
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4')
    socket.once('error', reject)
    socket.connect(1900, host, () => {
      const { address } = socket.address()
      socket.close()
      resolve(address)
    })
  })
}
