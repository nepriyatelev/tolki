import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'
import { keepAlive } from './heartbeat'

function fakeSocket() {
  const socket = Object.assign(new EventEmitter(), { ping: vi.fn(), terminate: vi.fn() })
  return socket
}

describe('keepAlive (#31)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('pings every interval and drops a peer that stopped answering', () => {
    vi.useFakeTimers()
    const socket = fakeSocket()
    keepAlive(socket as unknown as WebSocket, 1000)

    vi.advanceTimersByTime(1000)
    expect(socket.ping).toHaveBeenCalledOnce()
    socket.emit('pong')
    vi.advanceTimersByTime(1000)
    expect(socket.ping).toHaveBeenCalledTimes(2)
    expect(socket.terminate).not.toHaveBeenCalled()

    // No pong for a whole interval: gone.
    vi.advanceTimersByTime(1000)
    expect(socket.terminate).toHaveBeenCalledOnce()
  })

  it('stops when the socket closes', () => {
    vi.useFakeTimers()
    const socket = fakeSocket()
    keepAlive(socket as unknown as WebSocket, 1000)
    socket.emit('close')
    vi.advanceTimersByTime(5000)
    expect(socket.ping).not.toHaveBeenCalled()
  })
})
