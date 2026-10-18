import { describe, expect, it, vi } from 'vitest'
import type { JoinResult, MediaResponse, RoomClosedReason, RoomEvent } from '@shared/room'
import type { JoinRequest, RoomConnection } from './room-client'
import { RoomSession, type RoomSessionEvents } from './room-session'

const OK = (peerId: string): Extract<JoinResult, { ok: true }> => ({
  ok: true,
  peerId,
  peers: [],
  room: { name: 'Кино', peerCount: 1, hasPassword: false },
  routerRtpCapabilities: {},
  mutedPeers: [],
  screenMode: 'auto',
  sharerId: null,
})

/** A connection whose drop, events and requests the test controls. */
function fakeConnection(result: JoinResult = OK('p1')) {
  let closed: (reason: RoomClosedReason) => void = () => undefined
  const early: RoomEvent[] = []
  let listener: ((event: RoomEvent) => void) | null = null
  const connection = {
    result,
    close: vi.fn(),
    onClosed: (l: (reason: RoomClosedReason) => void) => {
      closed = l
    },
    request: vi.fn(() => Promise.resolve<MediaResponse>({ ok: true, data: result })),
    onEvent: (l: (event: RoomEvent) => void) => {
      listener = l
      for (const e of early.splice(0)) l(e)
    },
  } satisfies RoomConnection
  return {
    connection,
    drop: (reason: RoomClosedReason = 'connection-lost') => {
      closed(reason)
    },
    emit: (event: RoomEvent) => {
      if (listener) listener(event)
      else early.push(event)
    },
  }
}

function events() {
  return {
    onReconnecting: vi.fn(),
    onReconnected: vi.fn<RoomSessionEvents['onReconnected']>(),
    onEvent: vi.fn<RoomSessionEvents['onEvent']>(),
    onClosed: vi.fn<RoomSessionEvents['onClosed']>(),
  }
}

const REQUEST = { invite: {} as JoinRequest['invite'], name: 'Катя', password: undefined }

/** Time that only moves when the session sleeps. */
function clock() {
  let now = 0
  const pauses: number[] = []
  return {
    now: () => now,
    sleep: (ms: number) => {
      pauses.push(ms)
      now += ms
      return Promise.resolve()
    },
    pauses,
  }
}

describe('RoomSession (#31)', () => {
  it('passes on the first events, even those that came with welcome', () => {
    const first = fakeConnection()
    const peer = { type: 'peer-joined', peer: { id: 'd', name: 'Дима' } } as const
    first.emit(peer)
    const on = events()
    new RoomSession(first.connection, REQUEST, on, { join: vi.fn() })
    expect(on.onEvent).toHaveBeenCalledWith(peer)
  })

  it('rejoins after a drop, backing off, and carries on with the new connection', async () => {
    const first = fakeConnection()
    const second = fakeConnection(OK('p2'))
    const time = clock()
    const join = vi
      .fn<(r: JoinRequest) => Promise<RoomConnection>>()
      .mockResolvedValueOnce(fakeConnection({ ok: false, error: 'unreachable' }).connection)
      .mockResolvedValueOnce(fakeConnection({ ok: false, error: 'timeout' }).connection)
      .mockResolvedValueOnce(second.connection)
    const on = events()
    const session = new RoomSession(first.connection, REQUEST, on, { join, ...time })

    first.drop()
    expect(on.onReconnecting).toHaveBeenCalledOnce()
    expect(await session.request({ method: 'createTransport', direction: 'send' })).toEqual({
      ok: false,
      error: 'reconnecting',
    })
    await vi.waitFor(() => {
      expect(on.onReconnected).toHaveBeenCalledWith(OK('p2'))
    })

    expect(time.pauses).toEqual([500, 1000, 2000])
    expect(join).toHaveBeenCalledWith(REQUEST)
    second.emit({ type: 'peer-left', peerId: 'x' })
    expect(on.onEvent).toHaveBeenLastCalledWith({ type: 'peer-left', peerId: 'x' })
    await session.request({ method: 'createTransport', direction: 'send' })
    expect(second.connection.request).toHaveBeenCalled()
    expect(on.onClosed).not.toHaveBeenCalled()
  })

  it('gives up after 30 s without the room', async () => {
    const first = fakeConnection()
    const time = clock()
    const join = vi.fn(() =>
      Promise.resolve<RoomConnection>(
        fakeConnection({ ok: false, error: 'unreachable' }).connection,
      ),
    )
    const on = events()
    new RoomSession(first.connection, REQUEST, on, { join, ...time })

    first.drop()
    await vi.waitFor(() => {
      expect(on.onClosed).toHaveBeenCalledWith('connection-lost')
    })
    expect(time.now()).toBe(30_000)
    expect(time.pauses.at(-1)).toBeLessThan(8000)
    expect(join.mock.calls.length).toBeGreaterThan(3)
  })

  it('stops at once when the room will not take the user back', async () => {
    const first = fakeConnection()
    const join = vi.fn(() =>
      Promise.resolve<RoomConnection>(fakeConnection({ ok: false, error: 'ROOM_FULL' }).connection),
    )
    const on = events()
    new RoomSession(first.connection, REQUEST, on, { join, ...clock() })

    first.drop()
    await vi.waitFor(() => {
      expect(on.onClosed).toHaveBeenCalledWith('connection-lost')
    })
    expect(join).toHaveBeenCalledOnce()
  })

  it('does not reconnect when the host closed the room', () => {
    const first = fakeConnection()
    const join = vi.fn()
    const on = events()
    new RoomSession(first.connection, REQUEST, on, { join })

    first.drop('host-closed')

    expect(on.onClosed).toHaveBeenCalledWith('host-closed')
    expect(on.onReconnecting).not.toHaveBeenCalled()
    expect(join).not.toHaveBeenCalled()
  })

  it('goes quiet when the user leaves, even mid-reconnect', async () => {
    const first = fakeConnection()
    const late = fakeConnection(OK('p2'))
    let release: () => void = () => undefined
    const join = vi.fn(
      () =>
        new Promise<RoomConnection>((resolve) => {
          release = () => {
            resolve(late.connection)
          }
        }),
    )
    const on = events()
    const session = new RoomSession(first.connection, REQUEST, on, { join, ...clock() })
    first.drop()
    await vi.waitFor(() => {
      expect(join).toHaveBeenCalled()
    })

    session.leave()
    release()

    await vi.waitFor(() => {
      expect(late.connection.close).toHaveBeenCalled()
    })
    expect(on.onReconnected).not.toHaveBeenCalled()
    expect(on.onClosed).not.toHaveBeenCalled()
  })
})
