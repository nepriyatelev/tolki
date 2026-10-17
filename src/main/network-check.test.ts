import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HostState, MainToHostMessage, PortMappingState } from '@shared/host-protocol'
import type { HostChild } from './host-process'
import { NetworkChecker, type HostView } from './network-check'

const MAPPED: PortMappingState = {
  status: 'mapped',
  method: 'pcp',
  externalAddress: '93.184.216.34',
  externalPort: 47000,
  externalUdpPort: 47000,
}

class FakeChild extends EventEmitter implements HostChild {
  readonly sent: MainToHostMessage[] = []
  killed = false
  postMessage(message: MainToHostMessage): void {
    this.sent.push(message)
  }
  kill(): boolean {
    this.killed = true
    return true
  }
  answer(portMapping: PortMappingState): void {
    this.emit('message', { type: 'check-result', portMapping })
    this.emit('exit', 0)
  }
}

class FakeHost extends EventEmitter implements HostView {
  state: HostState = { status: 'stopped' }
  onState(listener: (state: HostState) => void): () => void {
    this.on('state', listener)
    return () => this.off('state', listener)
  }
  set(state: HostState): void {
    this.state = state
    this.emit('state', state)
  }
}

function setup(options: { portMappingEnabled?: boolean; timeoutMs?: number } = {}) {
  const children: FakeChild[] = []
  const host = new FakeHost()
  let now = 1_000_000
  const checker = new NetworkChecker({
    spawn: () => {
      const child = new FakeChild()
      children.push(child)
      return child
    },
    host,
    ipv6Address: () => null,
    portMappingEnabled: options.portMappingEnabled ?? true,
    timeoutMs: options.timeoutMs ?? 1000,
    cacheMs: 60_000,
    now: () => now,
  })
  return {
    checker,
    children,
    host,
    advance: (ms: number) => {
      now += ms
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('NetworkChecker', () => {
  it('runs a one-shot check in the host process and assesses the result', async () => {
    const { checker, children } = setup()

    const result = checker.check(47000)
    expect(children[0]?.sent).toEqual([{ type: 'check', port: 47000 }])
    children[0]?.answer(MAPPED)

    await expect(result).resolves.toMatchObject({
      port: 47000,
      portMapping: MAPPED,
      ipv6Address: null,
      verdict: { canHost: true, via: 'ipv4', externalAddress: '93.184.216.34' },
    })
  })

  it('shares one run between concurrent callers and caches the answer', async () => {
    const { checker, children, advance } = setup()

    const a = checker.check(47000)
    const b = checker.check(47000)
    children[0]?.answer(MAPPED)
    await Promise.all([a, b])
    advance(30_000)
    await checker.check(47000)

    expect(children).toHaveLength(1)
  })

  it('re-checks when forced, when the cache is stale or for another port', async () => {
    const { checker, children, advance } = setup()
    const run = async (p: Promise<unknown>, i: number) => {
      children[i]?.answer(MAPPED)
      await p
    }

    await run(checker.check(47000), 0)
    await run(checker.check(47000, { force: true }), 1)
    advance(61_000)
    await run(checker.check(47000), 2)
    await run(checker.check(47001), 3)

    expect(children).toHaveLength(4)
  })

  it('reuses the mapping of a running room instead of mapping the port twice', async () => {
    const { checker, children, host } = setup()
    host.set({
      status: 'running',
      port: 47000,
      fingerprint: 'f',
      portMapping: { status: 'pending' },
    })

    const result = checker.check(47000)
    host.set({ status: 'running', port: 47000, fingerprint: 'f', portMapping: MAPPED })

    await expect(result).resolves.toMatchObject({ portMapping: MAPPED })
    expect(children).toHaveLength(0)
  })

  it('does not touch the router when port mapping is turned off', async () => {
    const { checker, children } = setup({ portMappingEnabled: false })

    await expect(checker.check(47000)).resolves.toMatchObject({
      portMapping: { status: 'disabled' },
      verdict: { canHost: false, problem: 'mapping-disabled' },
    })
    expect(children).toHaveLength(0)
  })

  it('reports a failed check when the process exits without an answer', async () => {
    const { checker, children } = setup()

    const result = checker.check(47000)
    children[0]?.emit('exit', 1)

    await expect(result).resolves.toMatchObject({
      portMapping: { status: 'failed', reason: 'unsupported' },
      verdict: { canHost: false },
    })
  })

  it('times out and kills a stuck check', async () => {
    vi.useFakeTimers()
    const { checker, children } = setup({ timeoutMs: 100 })

    const result = checker.check(47000)
    await vi.advanceTimersByTimeAsync(100)

    await expect(result).resolves.toMatchObject({ portMapping: { status: 'failed' } })
    expect(children[0]?.killed).toBe(true)
  })
})
