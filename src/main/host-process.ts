import {
  hostToMainMessageSchema,
  type HostStatus,
  type MainToHostMessage,
} from '@shared/host-protocol'

/** The part of Electron's UtilityProcess that HostProcess relies on. */
export interface HostChild {
  on(event: 'message', listener: (message: unknown) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  postMessage(message: MainToHostMessage): void
  kill(): boolean
}

export interface HostProcessOptions {
  spawn: () => HostChild
  readyTimeoutMs?: number
  stopTimeoutMs?: number
}

/**
 * Owns the `host` utility process: starts it on demand, waits for its `ready` message,
 * and stops it gracefully (shutdown message, then kill after a timeout).
 */
export class HostProcess {
  #status: HostStatus = 'stopped'
  #child: HostChild | null = null
  #pending: Promise<HostStatus> | null = null
  readonly #listeners = new Set<(status: HostStatus) => void>()
  readonly #spawn: () => HostChild
  readonly #readyTimeoutMs: number
  readonly #stopTimeoutMs: number

  constructor(options: HostProcessOptions) {
    this.#spawn = options.spawn
    this.#readyTimeoutMs = options.readyTimeoutMs ?? 10_000
    this.#stopTimeoutMs = options.stopTimeoutMs ?? 5_000
  }

  get status(): HostStatus {
    return this.#status
  }

  onStatus(listener: (status: HostStatus) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async start(): Promise<HostStatus> {
    if (this.#pending) await this.#pending
    if (this.#status === 'running') return this.#status

    this.#pending = this.#doStart().finally(() => {
      this.#pending = null
    })
    return this.#pending
  }

  async stop(): Promise<HostStatus> {
    if (this.#pending) await this.#pending.catch(() => undefined)
    if (this.#status === 'stopped') return this.#status

    this.#pending = this.#doStop().finally(() => {
      this.#pending = null
    })
    return this.#pending
  }

  #doStart(): Promise<HostStatus> {
    this.#setStatus('starting')
    const child = this.#spawn()
    this.#child = child

    return new Promise<HostStatus>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Reject before killing: kill() may emit 'exit' synchronously.
        reject(new Error(`host process did not report ready within ${this.#readyTimeoutMs} ms`))
        child.kill()
      }, this.#readyTimeoutMs)

      child.on('message', (raw) => {
        const message = hostToMainMessageSchema.safeParse(raw)
        if (!message.success) return
        switch (message.data.type) {
          case 'ready':
            if (this.#status !== 'starting') return
            clearTimeout(timer)
            this.#setStatus('running')
            resolve(this.#status)
            return
          case 'fatal':
            console.error(`[host] fatal: ${message.data.message}`)
            return
        }
      })

      child.on('exit', (code) => {
        clearTimeout(timer)
        if (this.#child === child) this.#child = null
        const wasStarting = this.#status === 'starting'
        this.#setStatus('stopped')
        if (wasStarting) reject(new Error(`host process exited during startup (code ${code})`))
      })
    })
  }

  #doStop(): Promise<HostStatus> {
    const child = this.#child
    if (!child) {
      this.#setStatus('stopped')
      return Promise.resolve(this.#status)
    }

    this.#setStatus('stopping')
    return new Promise<HostStatus>((resolve) => {
      const timer = setTimeout(() => child.kill(), this.#stopTimeoutMs)
      child.on('exit', () => {
        clearTimeout(timer)
        resolve(this.#status)
      })
      child.postMessage({ type: 'shutdown' })
    })
  }

  #setStatus(status: HostStatus): void {
    if (this.#status === status) return
    this.#status = status
    for (const listener of this.#listeners) listener(status)
  }
}
