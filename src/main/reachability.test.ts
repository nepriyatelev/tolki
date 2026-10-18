import { connect, createServer } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import { checkReachability } from './reachability'

const answer = (body: unknown, status = 200) =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })))

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const { port } = server.address() as { port: number }
  await new Promise((resolve) => server.close(resolve))
  return port
}

describe('checkReachability (#128)', () => {
  it('listens on the port while the checker knocks, then lets it go', async () => {
    const port = await freePort()
    // The checker connects back: here, to localhost.
    const fetch = vi.fn(async (url: string) => {
      expect(url).toBe(`https://ifconfig.co/port/${port}`)
      await new Promise<void>((resolve, reject) => {
        const socket = connect(port, '127.0.0.1', () => {
          socket.destroy()
          resolve()
        })
        socket.on('error', reject)
      })
      return new Response(JSON.stringify({ ip: '93.184.216.34', port, reachable: true }))
    })
    expect(await checkReachability({ port, roomListening: false, fetch })).toBe('reachable')
    // Released: the room can take the port.
    const again = createServer()
    await new Promise<void>((resolve) => again.listen(port, resolve))
    again.close()
  })

  it('tells closed from unknown', async () => {
    const port = await freePort()
    expect(
      await checkReachability({ port, roomListening: false, fetch: answer({ reachable: false }) }),
    ).toBe('closed')
    expect(
      await checkReachability({ port, roomListening: false, fetch: answer({ error: 'x' }, 500) }),
    ).toBe('unknown')
    expect(
      await checkReachability({
        port,
        roomListening: false,
        fetch: () => Promise.reject(new Error('offline')),
      }),
    ).toBe('unknown')
  })

  it('uses the open room instead of its own listener; a busy port is unknown', async () => {
    const busy = createServer()
    await new Promise<void>((resolve) => busy.listen(0, resolve))
    const { port } = busy.address() as { port: number }
    const fetch = answer({ reachable: true })
    expect(await checkReachability({ port, roomListening: true, fetch })).toBe('reachable')
    expect(await checkReachability({ port, roomListening: false, fetch })).toBe('unknown')
    busy.close()
  })
})
