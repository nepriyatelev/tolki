import type { JoinResult, MediaResponse, RoomClosedReason, RoomEvent } from '@shared/room'
import type { MediaRequest } from '@shared/signaling'
import type { JoinRequest, RoomConnection } from './room-client'

/** Pauses between reconnection attempts, then the last one again (PLAN #31). */
export const RECONNECT_BACKOFF_MS = [500, 1000, 2000, 4000, 8000]
/** After this long without the room, the user gets «Связь с комнатой потеряна». */
export const RECONNECT_DEADLINE_MS = 30_000

export interface RoomSessionEvents {
  /** The link dropped; the session is trying to get back. */
  onReconnecting: () => void
  /** Back in the room as a new participant (new id, fresh media). */
  onReconnected: (result: Extract<JoinResult, { ok: true }>) => void
  /** Room events of whichever connection is current. */
  onEvent: (event: RoomEvent) => void
  /** The room is over for this user: closed by the host, or not reachable for 30 s. */
  onClosed: (reason: RoomClosedReason) => void
}

export interface RoomSessionOptions {
  join: (request: JoinRequest) => Promise<RoomConnection>
  backoffMs?: number[]
  deadlineMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/**
 * A joined room that survives a dropped link (PLAN #31): when the connection drops without the
 * host closing the room, it joins again with the same name and password, pausing longer between
 * attempts, until it is back or 30 s have passed.
 */
export class RoomSession {
  #connection: RoomConnection
  #left = false
  #reconnecting = false
  readonly #backoff: number[]
  readonly #deadline: number
  readonly #now: () => number
  readonly #sleep: (ms: number) => Promise<void>

  constructor(
    connection: RoomConnection,
    private readonly joinRequest: JoinRequest,
    private readonly events: RoomSessionEvents,
    private readonly options: RoomSessionOptions,
  ) {
    this.#connection = connection
    this.#backoff = options.backoffMs ?? RECONNECT_BACKOFF_MS
    this.#deadline = options.deadlineMs ?? RECONNECT_DEADLINE_MS
    this.#now = options.now ?? Date.now
    this.#sleep =
      options.sleep ??
      ((ms) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms)
        }))
    this.#forwardEvents(connection)
    this.#watch(connection)
  }

  get reconnecting(): boolean {
    return this.#reconnecting
  }

  /** Media requests go to the current connection; during a reconnect they fail fast. */
  request(request: MediaRequest): Promise<MediaResponse> {
    if (this.#reconnecting) return Promise.resolve({ ok: false, error: 'reconnecting' })
    return this.#connection.request(request)
  }

  /** The user left: no reconnecting, no events, no onClosed. */
  leave(): void {
    this.#left = true
    this.#connection.close()
  }

  #forwardEvents(connection: RoomConnection): void {
    connection.onEvent((event) => {
      if (connection === this.#connection && !this.#reconnecting && !this.#left) {
        this.events.onEvent(event)
      }
    })
  }

  #watch(connection: RoomConnection): void {
    connection.onClosed((reason) => {
      if (this.#left || connection !== this.#connection) return
      if (reason === 'host-closed') {
        this.events.onClosed('host-closed')
        return
      }
      void this.#reconnect()
    })
  }

  async #reconnect(): Promise<void> {
    this.#reconnecting = true
    this.events.onReconnecting()
    const giveUpAt = this.#now() + this.#deadline
    for (let attempt = 0; this.#now() < giveUpAt; attempt++) {
      const pause = this.#backoff[Math.min(attempt, this.#backoff.length - 1)] ?? 1000
      // The last pause is cut short: the final attempt comes right at the deadline.
      await this.#sleep(Math.min(pause, giveUpAt - this.#now()))
      if (this.#hasLeft()) return
      const connection = await this.options.join(this.joinRequest)
      if (this.#hasLeft()) {
        connection.close()
        return
      }
      const { result } = connection
      if (result.ok) {
        this.#connection = connection
        this.#reconnecting = false
        // First the new room state, then its events: the renderer restarts the call in between.
        this.events.onReconnected(result)
        this.#forwardEvents(connection)
        this.#watch(connection)
        return
      }
      // The room is there but will not take this user back (full, password changed…).
      if (result.error !== 'unreachable' && result.error !== 'timeout') break
    }
    this.#reconnecting = false
    if (!this.#hasLeft()) this.events.onClosed('connection-lost')
  }

  /** A method, not the field: the user may leave while a reconnect waits. */
  #hasLeft(): boolean {
    return this.#left
  }
}
