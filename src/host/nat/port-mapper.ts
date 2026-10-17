import type { PortMappingMethod, PortMappingState } from '@shared/host-protocol'

export interface MappedPort {
  externalAddress: string
  /** External TCP port (signalling, and the port in the invite link). */
  externalPort: number
  /** External UDP port (media); usually equal to externalPort. */
  externalUdpPort: number
}

/** One way of asking the router to forward a port (PCP, NAT-PMP or UPnP). */
export interface MappingStrategy {
  readonly method: PortMappingMethod
  /** Maps TCP and UDP for `port`. Throws MethodUnavailableError if the router does not speak it. */
  map(port: number): Promise<MappedPort>
  /** Removes the mappings and stops renewals. Never throws. */
  close(): Promise<void>
}

/** The router does not support this method (no answer, no device): try the next one. */
export class MethodUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MethodUnavailableError'
  }
}

export interface PortMappingSession {
  readonly state: PortMappingState
  /** Removes the mapping, if any. Never throws. */
  close(): Promise<void>
}

/**
 * Tries each strategy in order until one maps the port. A refusal from one method does not stop
 * the others: some routers deny PCP but allow UPnP. Never throws — failures become a state.
 */
export async function mapPort(
  port: number,
  strategies: readonly MappingStrategy[],
  options: { hasGateway: boolean },
): Promise<PortMappingSession> {
  const refusals: string[] = []

  for (const strategy of strategies) {
    try {
      const mapped = await strategy.map(port)
      return {
        state: { status: 'mapped', method: strategy.method, ...mapped },
        close: () => strategy.close(),
      }
    } catch (error) {
      await strategy.close()
      if (!(error instanceof MethodUnavailableError)) {
        refusals.push(
          `${strategy.method}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }

  const state: PortMappingState =
    refusals.length > 0
      ? { status: 'failed', reason: 'refused', detail: refusals.join('; ') }
      : options.hasGateway
        ? {
            status: 'failed',
            reason: 'unsupported',
            detail: 'The router answered neither PCP, NAT-PMP nor UPnP',
          }
        : { status: 'failed', reason: 'no-gateway', detail: 'No IPv4 default gateway found' }

  return { state, close: () => Promise.resolve() }
}
