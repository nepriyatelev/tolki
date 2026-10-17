// @vitest-environment node
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MainToHostMessage } from '@shared/host-protocol'
import { HostProcess, type HostChild } from './host-process'

class FakeChild extends EventEmitter implements HostChild {
  readonly sent: MainToHostMessage[] = []
  killed = false

  postMessage(message: MainToHostMessage): void {
    this.sent.push(message)
  }

  kill(): boolean {
    this.killed = true
    this.emit('exit', 1)
    return true
  }

  ready(): void {
    this.emit('message', { type: 'ready' })
  }

  exit(code = 0): void {
    this.emit('exit', code)
  }
}

function setup(options: { readyTimeoutMs?: number; stopTimeoutMs?: number } = {}) {
  const children: FakeChild[] = []
  const host = new HostProcess({
    spawn: () => {
      const child = new FakeChild()
      children.push(child)
      return child
    },
    ...options,
  })
  const statuses: string[] = []
  host.onStatus((s) => statuses.push(s))
  return { host, children, statuses }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('HostProcess', () => {
  it('starts and becomes running after the ready message', async () => {
    const { host, children, statuses } = setup()

    const started = host.start()
    expect(host.status).toBe('starting')
    children[0]?.ready()

    await expect(started).resolves.toBe('running')
    expect(statuses).toEqual(['starting', 'running'])
  })

  it('ignores malformed messages from the child', async () => {
    const { host, children } = setup()

    const started = host.start()
    children[0]?.emit('message', { type: 'bogus' })
    children[0]?.emit('message', 'ready')
    expect(host.status).toBe('starting')
    children[0]?.ready()

    await expect(started).resolves.toBe('running')
  })

  it('reuses a running process instead of spawning a second one', async () => {
    const { host, children } = setup()

    const first = host.start()
    const second = host.start()
    children[0]?.ready()

    await expect(first).resolves.toBe('running')
    await expect(second).resolves.toBe('running')
    await expect(host.start()).resolves.toBe('running')
    expect(children).toHaveLength(1)
  })

  it('stops gracefully with a shutdown message', async () => {
    const { host, children, statuses } = setup()
    const started = host.start()
    children[0]?.ready()
    await started

    const stopped = host.stop()
    expect(host.status).toBe('stopping')
    expect(children[0]?.sent).toEqual([{ type: 'shutdown' }])
    children[0]?.exit(0)

    await expect(stopped).resolves.toBe('stopped')
    expect(children[0]?.killed).toBe(false)
    expect(statuses).toEqual(['starting', 'running', 'stopping', 'stopped'])
  })

  it('kills the child if it ignores shutdown', async () => {
    vi.useFakeTimers()
    const { host, children } = setup({ stopTimeoutMs: 100 })
    const started = host.start()
    children[0]?.ready()
    await started

    const stopped = host.stop()
    await vi.advanceTimersByTimeAsync(100)

    await expect(stopped).resolves.toBe('stopped')
    expect(children[0]?.killed).toBe(true)
  })

  it('fails and kills the child if it never reports ready', async () => {
    vi.useFakeTimers()
    const { host, children } = setup({ readyTimeoutMs: 100 })

    const started = host.start()
    const assertion = expect(started).rejects.toThrow(/did not report ready/)
    await vi.advanceTimersByTimeAsync(100)

    await assertion
    expect(children[0]?.killed).toBe(true)
    expect(host.status).toBe('stopped')
  })

  it('reports stopped when the child crashes while running', async () => {
    const { host, children } = setup()
    const started = host.start()
    children[0]?.ready()
    await started

    children[0]?.exit(1)

    expect(host.status).toBe('stopped')
  })

  it('can start again after stopping', async () => {
    const { host, children } = setup()
    const started = host.start()
    children[0]?.ready()
    await started
    const stopped = host.stop()
    children[0]?.exit(0)
    await stopped

    const restarted = host.start()
    children[1]?.ready()

    await expect(restarted).resolves.toBe('running')
    expect(children).toHaveLength(2)
  })

  it('stop() on a stopped host is a no-op', async () => {
    const { host, children } = setup()

    await expect(host.stop()).resolves.toBe('stopped')
    expect(children).toHaveLength(0)
  })
})
