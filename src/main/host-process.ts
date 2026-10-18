import {
  hostToMainMessageSchema,
  type HostStartFailure,
  type HostState,
  type MainToHostMessage,
} from '@shared/host-protocol'
import type { ScreenMode } from '@shared/screen'

/** The part of Electron's UtilityProcess that HostProcess relies on. */
export interface HostChild {
  on(event: 'message', listener: (message: unknown) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  postMessage(message: MainToHostMessage): void
  kill(): boolean
}

export interface HostStartOptions {
  port: number
  portMapping: boolean
  roomName: string
  password: string
  screenMode: ScreenMode
  /** Entry waits for the organizer (#42). */
  approval: boolean
  /** The organizer's own connection proves itself with it (#42). */
  organizerKey: string
  /** Where the host keeps its certificate (Electron userData). */
  dataDir: string
}

export interface HostProcessOptions {
  spawn: () => HostChild
  readyTimeoutMs?: number
  stopTimeoutMs?: number
}

export class HostStartError extends Error {
  constructor(
    readonly reason: HostStartFailure,
    message: string,
  ) {
    super(message)
    this.name = 'HostStartError'
  }
}

/**
 * Owns the `host` utility process: spawns it, asks it to start the signalling server on a port,
 * waits for `ready`, and stops it gracefully (shutdown message, then kill after a timeout).
 */
export class HostProcess {
  #state: HostState = { status: 'stopped' }
  #child: HostChild | null = null
  #pending: Promise<HostState> | null = null
  #portMapping = true
  readonly #listeners = new Set<(state: HostState) => void>()
  readonly #spawn: () => HostChild
  readonly #readyTimeoutMs: number
  readonly #stopTimeoutMs: number

  constructor(options: HostProcessOptions) {
    this.#spawn = options.spawn
    this.#readyTimeoutMs = options.readyTimeoutMs ?? 15_000
    this.#stopTimeoutMs = options.stopTimeoutMs ?? 5_000
  }

  get state(): HostState {
    return this.#state
  }

  onState(listener: (state: HostState) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** Starts the host, or returns the running one if it already listens on the same port. */
  async start(options: HostStartOptions): Promise<HostState> {
    if (this.#pending) await this.#pending.catch(() => undefined)
    if (this.#state.status === 'running') {
      if (this.#state.port === options.port && this.#portMapping === options.portMapping) {
        return this.#state
      }
      await this.stop()
    }

    this.#pending = this.#doStart(options).finally(() => {
      this.#pending = null
    })
    return this.#pending
  }

  /** The upload measured before the call (#86): the base of the screen's ceiling. */
  setUpload(mbps: number): void {
    this.#child?.postMessage({ type: 'upload', mbps })
  }

  async stop(): Promise<HostState> {
    if (this.#pending) await this.#pending.catch(() => undefined)
    if (this.#state.status === 'stopped') return this.#state

    this.#pending = this.#doStop().finally(() => {
      this.#pending = null
    })
    return this.#pending
  }

  #doStart(options: HostStartOptions): Promise<HostState> {
    this.#portMapping = options.portMapping
    this.#setState({ status: 'starting', port: options.port })
    const child = this.#spawn()
    this.#child = child

    return new Promise<HostState>((resolve, reject) => {
      let failure: HostStartError | null = null

      const timer = setTimeout(() => {
        failure = new HostStartError(
          'timeout',
          `host did not start within ${this.#readyTimeoutMs} ms`,
        )
        // Reject before killing: kill() may emit 'exit' synchronously.
        reject(failure)
        child.kill()
      }, this.#readyTimeoutMs)

      child.on('message', (raw) => {
        const message = hostToMainMessageSchema.safeParse(raw)
        if (!message.success) return
        switch (message.data.type) {
          case 'ready':
            if (this.#state.status !== 'starting') return
            clearTimeout(timer)
            this.#setState({
              status: 'running',
              port: message.data.port,
              fingerprint: message.data.fingerprint,
              portMapping: options.portMapping ? { status: 'pending' } : { status: 'disabled' },
            })
            resolve(this.#state)
            return
          case 'port-mapping':
            if (this.#state.status === 'running') {
              this.#setState({ ...this.#state, portMapping: message.data.state })
            }
            return
          case 'call-upload':
            if (this.#state.status === 'running') {
              this.#setState({ ...this.#state, callUpload: message.data.capacity })
            }
            return
          case 'start-failed':
            failure = new HostStartError(message.data.reason, message.data.message)
            return
          case 'fatal':
            console.error(`[host] fatal: ${message.data.message}`)
            return
        }
      })

      child.on('exit', (code) => {
        clearTimeout(timer)
        if (this.#child === child) this.#child = null
        if (this.#state.status === 'starting') {
          failure ??= new HostStartError('crashed', `host exited during startup (code ${code})`)
          this.#setState({ status: 'stopped', lastError: failure.reason })
          reject(failure)
        } else {
          this.#setState({ status: 'stopped' })
        }
      })

      child.postMessage({
        type: 'start',
        port: options.port,
        dataDir: options.dataDir,
        portMapping: options.portMapping,
        roomName: options.roomName,
        password: options.password,
        screenMode: options.screenMode,
        approval: options.approval,
        organizerKey: options.organizerKey,
      })
    })
  }

  #doStop(): Promise<HostState> {
    const child = this.#child
    if (!child || this.#state.status === 'stopped') {
      this.#setState({ status: 'stopped' })
      return Promise.resolve(this.#state)
    }

    const port = 'port' in this.#state ? this.#state.port : 0
    this.#setState({ status: 'stopping', port })
    return new Promise<HostState>((resolve) => {
      const timer = setTimeout(() => child.kill(), this.#stopTimeoutMs)
      child.on('exit', () => {
        clearTimeout(timer)
        resolve(this.#state)
      })
      child.postMessage({ type: 'shutdown' })
    })
  }

  #setState(state: HostState): void {
    this.#state = state
    for (const listener of this.#listeners) listener(state)
  }
}
