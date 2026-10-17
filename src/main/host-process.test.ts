import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HostState, MainToHostMessage } from '@shared/host-protocol'
import { HostProcess, HostStartError, type HostChild } from './host-process'

const OPTIONS = {
  port: 47000,
  dataDir: '/tmp/ratatosk',
  portMapping: true,
  roomName: 'Комната',
  password: '',
  screenMode: 'auto',
} as const
const FINGERPRINT = 'x'.repeat(43)

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

  ready(port = 47000): void {
    this.emit('message', { type: 'ready', port, fingerprint: FINGERPRINT })
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
  const states: HostState[] = []
  host.onState((s) => states.push(s))
  const statuses = () => states.map((s) => s.status)
  return { host, children, states, statuses }
}

async function startRunning() {
  const ctx = setup()
  const started = ctx.host.start(OPTIONS)
  ctx.children[0]?.ready()
  await started
  return ctx
}

afterEach(() => {
  vi.useRealTimers()
})

describe('HostProcess', () => {
  it('asks the child to start on the port and becomes running with the fingerprint', async () => {
    const { host, children, statuses } = setup()

    const started = host.start(OPTIONS)
    expect(host.state).toEqual({ status: 'starting', port: 47000 })
    expect(children[0]?.sent).toEqual([
      {
        type: 'start',
        port: 47000,
        dataDir: '/tmp/ratatosk',
        portMapping: true,
        roomName: 'Комната',
        password: '',
        screenMode: 'auto',
      },
    ])
    children[0]?.ready()

    await expect(started).resolves.toEqual({
      status: 'running',
      port: 47000,
      fingerprint: FINGERPRINT,
      portMapping: { status: 'pending' },
    })
    expect(statuses()).toEqual(['starting', 'running'])
  })

  it('reports port mapping as disabled when it was not requested', async () => {
    const { host, children } = setup()

    const started = host.start({ ...OPTIONS, portMapping: false })
    children[0]?.ready()

    await expect(started).resolves.toMatchObject({ portMapping: { status: 'disabled' } })
  })

  it('updates the running state with the port mapping result', async () => {
    const { host, children, states } = await startRunning()
    const mapped = {
      status: 'mapped',
      method: 'upnp',
      externalAddress: '203.0.113.5',
      externalPort: 47000,
      externalUdpPort: 47000,
    } as const

    children[0]?.emit('message', { type: 'port-mapping', state: mapped })

    expect(host.state).toMatchObject({ status: 'running', portMapping: mapped })
    expect(states.at(-1)).toMatchObject({ portMapping: mapped })
  })

  it('keeps the live upload estimate from the call', async () => {
    const { host, children } = await startRunning()
    const capacity = { uploadMbps: 12, participants: 15, screen: '720p' } as const

    children[0]?.emit('message', { type: 'call-upload', capacity })

    expect(host.state).toMatchObject({ status: 'running', callUpload: capacity })
  })

  it('ignores malformed port mapping results', async () => {
    const { host, children } = await startRunning()

    children[0]?.emit('message', { type: 'port-mapping', state: { status: 'mapped' } })

    expect(host.state).toMatchObject({ portMapping: { status: 'pending' } })
  })

  it('ignores malformed messages from the child', async () => {
    const { host, children } = setup()

    const started = host.start(OPTIONS)
    children[0]?.emit('message', { type: 'bogus' })
    children[0]?.emit('message', { type: 'ready', port: 80, fingerprint: FINGERPRINT })
    children[0]?.emit('message', 'ready')
    expect(host.state.status).toBe('starting')
    children[0]?.ready()

    await expect(started).resolves.toMatchObject({ status: 'running' })
  })

  it('reuses a running process on the same port', async () => {
    const { host, children } = setup()

    const first = host.start(OPTIONS)
    const second = host.start(OPTIONS)
    children[0]?.ready()

    await expect(first).resolves.toMatchObject({ status: 'running' })
    await expect(second).resolves.toMatchObject({ status: 'running' })
    await expect(host.start(OPTIONS)).resolves.toMatchObject({ status: 'running' })
    expect(children).toHaveLength(1)
  })

  it('restarts on a different port', async () => {
    const { host, children } = await startRunning()

    const restarted = host.start({ ...OPTIONS, port: 47001 })
    await vi.waitFor(() => {
      expect(children[0]?.sent.at(-1)).toEqual({ type: 'shutdown' })
    })
    children[0]?.exit(0)
    await vi.waitFor(() => {
      expect(children).toHaveLength(2)
    })
    children[1]?.ready(47001)

    await expect(restarted).resolves.toMatchObject({ status: 'running', port: 47001 })
  })

  it('reports the reason when the server cannot start', async () => {
    const { host, children } = setup()

    const started = host.start(OPTIONS)
    children[0]?.emit('message', {
      type: 'start-failed',
      reason: 'port-in-use',
      message: 'Port 47000 is already in use',
    })
    children[0]?.exit(1)

    const error = await started.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(HostStartError)
    expect((error as HostStartError).reason).toBe('port-in-use')
    expect(host.state).toEqual({ status: 'stopped', lastError: 'port-in-use' })
  })

  it('reports a crash when the child exits during startup without a reason', async () => {
    const { host, children } = setup()

    const started = host.start(OPTIONS)
    children[0]?.exit(3)

    await expect(started).rejects.toMatchObject({ reason: 'crashed' })
    expect(host.state).toEqual({ status: 'stopped', lastError: 'crashed' })
  })

  it('fails with timeout and kills the child if it never reports ready', async () => {
    vi.useFakeTimers()
    const { host, children } = setup({ readyTimeoutMs: 100 })

    const started = host.start(OPTIONS)
    const assertion = expect(started).rejects.toMatchObject({ reason: 'timeout' })
    await vi.advanceTimersByTimeAsync(100)

    await assertion
    expect(children[0]?.killed).toBe(true)
    expect(host.state).toEqual({ status: 'stopped', lastError: 'timeout' })
  })

  it('stops gracefully with a shutdown message', async () => {
    const { host, children, statuses } = await startRunning()

    const stopped = host.stop()
    expect(host.state).toEqual({ status: 'stopping', port: 47000 })
    expect(children[0]?.sent.at(-1)).toEqual({ type: 'shutdown' })
    children[0]?.exit(0)

    await expect(stopped).resolves.toEqual({ status: 'stopped' })
    expect(children[0]?.killed).toBe(false)
    expect(statuses()).toEqual(['starting', 'running', 'stopping', 'stopped'])
  })

  it('kills the child if it ignores shutdown', async () => {
    vi.useFakeTimers()
    const ctx = setup({ stopTimeoutMs: 100 })
    const started = ctx.host.start(OPTIONS)
    ctx.children[0]?.ready()
    await started

    const stopped = ctx.host.stop()
    await vi.advanceTimersByTimeAsync(100)

    await expect(stopped).resolves.toEqual({ status: 'stopped' })
    expect(ctx.children[0]?.killed).toBe(true)
  })

  it('reports stopped without an error when the child crashes while running', async () => {
    const { host, children } = await startRunning()

    children[0]?.exit(1)

    expect(host.state).toEqual({ status: 'stopped' })
  })

  it('can start again after a failed start', async () => {
    const { host, children } = setup()
    const failed = host.start(OPTIONS)
    children[0]?.exit(1)
    await failed.catch(() => undefined)

    const retried = host.start(OPTIONS)
    children[1]?.ready()

    await expect(retried).resolves.toMatchObject({ status: 'running' })
  })

  it('stop() on a stopped host is a no-op', async () => {
    const { host, children } = setup()

    await expect(host.stop()).resolves.toEqual({ status: 'stopped' })
    expect(children).toHaveLength(0)
  })
})
