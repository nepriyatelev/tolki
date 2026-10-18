import { networkInterfaces } from 'node:os'
import {
  hostToMainMessageSchema,
  type HostState,
  type PortMappingState,
} from '@shared/host-protocol'
import {
  assessHosting,
  classifyIPv4,
  isGlobalIPv6,
  type NetworkCheckResult,
  type Reachability,
} from '@shared/network'
import type { HostChild } from './host-process'

/** What the checker needs from HostProcess: a running room already knows its mapping. */
export interface HostView {
  readonly state: HostState
  onState(listener: (state: HostState) => void): () => void
}

export interface NetworkCheckerOptions {
  /** Spawns the host utility process for a one-shot `check`. */
  spawn: () => HostChild
  host: HostView
  ipv6Address?: () => string | null
  localAddress?: () => string | null
  /** False when automatic forwarding is turned off: the check then skips the router. */
  portMappingEnabled: boolean
  /** This computer's address as the internet sees it (#128); absent: not asked (e2e). */
  stunAddress?: () => Promise<string | null>
  /**
   * Whether the port answers from outside (#128), asked when the router did not open it;
   * absent: not asked (e2e).
   */
  reachability?: (port: number, roomListening: boolean) => Promise<Reachability>
  /** The router's address in the home network. */
  gateway?: () => Promise<string | null>
  timeoutMs?: number
  /** A fresh result is reused for this long, so reopening the home screen does not re-map. */
  cacheMs?: number
  now?: () => number
}

/** Answers "can this computer host a room?" (PLAN #9) and caches the answer. */
export class NetworkChecker {
  #last: NetworkCheckResult | null = null
  #pending: Promise<NetworkCheckResult> | null = null
  readonly #options: Required<NetworkCheckerOptions>

  constructor(options: NetworkCheckerOptions) {
    this.#options = {
      ipv6Address: findGlobalIPv6,
      localAddress: findLocalIPv4,
      stunAddress: () => Promise.resolve(null),
      reachability: () => Promise.resolve('skipped'),
      gateway: () => Promise.resolve(null),
      timeoutMs: 30_000,
      cacheMs: 10 * 60_000,
      now: Date.now,
      ...options,
    }
  }

  get last(): NetworkCheckResult | null {
    return this.#last
  }

  check(port: number, { force = false }: { force?: boolean } = {}): Promise<NetworkCheckResult> {
    if (this.#pending) return this.#pending
    const last = this.#last
    if (
      !force &&
      last?.port === port &&
      this.#options.now() - last.checkedAt < this.#options.cacheMs
    ) {
      return Promise.resolve(last)
    }

    this.#pending = this.#run(port).finally(() => {
      this.#pending = null
    })
    return this.#pending
  }

  async #run(port: number): Promise<NetworkCheckResult> {
    const [portMapping, stunAddress, gateway] = await Promise.all([
      this.#portMapping(port),
      this.#options.stunAddress().catch(() => null),
      this.#options.gateway().catch(() => null),
    ])
    // A port the router opened is removed right after the check: nothing to knock on then.
    const host = this.#options.host.state
    const reachability: Reachability =
      portMapping.status === 'mapped'
        ? 'skipped'
        : await this.#options
            .reachability(port, host.status === 'running' && host.port === port)
            .catch((): Reachability => 'unknown')
    const ipv6Address = this.#options.ipv6Address()
    const result: NetworkCheckResult = {
      checkedAt: this.#options.now(),
      port,
      portMapping,
      ipv6Address,
      localAddress: this.#options.localAddress(),
      gateway,
      stunAddress,
      reachability,
      verdict: assessHosting({ portMapping, ipv6Address, stunAddress, reachability, port }),
    }
    this.#last = result
    return result
  }

  async #portMapping(port: number): Promise<PortMappingState> {
    if (!this.#options.portMappingEnabled) return { status: 'disabled' }
    if (this.#options.host.state.status !== 'stopped') {
      const fromRoom = await this.#waitForRoomMapping()
      if (fromRoom) return fromRoom
    }
    return this.#probe(port)
  }

  /** Uses the running room's mapping instead of mapping the same port a second time. */
  #waitForRoomMapping(): Promise<PortMappingState | null> {
    const settled = (state: HostState): PortMappingState | null | undefined => {
      if (state.status === 'stopped') return null
      if (state.status === 'running' && state.portMapping.status !== 'pending') {
        return state.portMapping
      }
      return undefined
    }
    const now = settled(this.#options.host.state)
    if (now !== undefined) return Promise.resolve(now)

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        off()
        resolve(null)
      }, this.#options.timeoutMs)
      const off = this.#options.host.onState((state) => {
        const value = settled(state)
        if (value === undefined) return
        clearTimeout(timer)
        off()
        resolve(value)
      })
    })
  }

  #probe(port: number): Promise<PortMappingState> {
    const child = this.#options.spawn()
    return new Promise((resolve) => {
      let done = false
      const finish = (state: PortMappingState): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve(state)
      }
      const timer = setTimeout(() => {
        finish({ status: 'failed', reason: 'unsupported', detail: 'Network check timed out' })
        child.kill()
      }, this.#options.timeoutMs)

      child.on('message', (raw) => {
        const message = hostToMainMessageSchema.safeParse(raw)
        if (message.success && message.data.type === 'check-result') {
          finish(message.data.portMapping)
        }
      })
      child.on('exit', (code) => {
        finish({
          status: 'failed',
          reason: 'unsupported',
          detail: `Network check exited unexpectedly (code ${code})`,
        })
      })
      child.postMessage({ type: 'check', port })
    })
  }
}

/** First global IPv6 address of any non-internal interface, or null. */
export function findGlobalIPv6(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const info of addresses ?? []) {
      if (info.family === 'IPv6' && !info.internal && isGlobalIPv6(info.address)) {
        return info.address
      }
    }
  }
  return null
}

/** First private IPv4 address of a non-internal interface (the address a router forwards to). */
export function findLocalIPv4(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const info of addresses ?? []) {
      if (info.family === 'IPv4' && !info.internal && classifyIPv4(info.address) === 'private') {
        return info.address
      }
    }
  }
  return null
}
