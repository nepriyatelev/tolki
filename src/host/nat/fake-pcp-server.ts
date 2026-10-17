import { createSocket, type Socket } from 'node:dgram'

/** Minimal PCP (RFC 6887) server for tests. Not shipped: only *.test.ts import it. */
export interface FakePcpServer {
  port: number
  /** Decoded MAP requests received so far. */
  requests: { protocol: number; internalPort: number; externalPort: number; lifetime: number }[]
  /** Active mappings keyed by "protocol:internalPort". */
  mappings: Map<string, number>
  close(): Promise<void>
}

export interface FakePcpOptions {
  externalAddress?: string
  /** Reply with this result code instead of SUCCESS. */
  resultCode?: number
  /** Behave like a NAT-PMP-only router (version 0 reply). */
  natPmpOnly?: boolean
  /** Assign this external port instead of the suggested one. */
  assignPort?: number
  /** Drop the first N requests to exercise retransmission. */
  dropFirst?: number
}

export async function startFakePcpServer(options: FakePcpOptions = {}): Promise<FakePcpServer> {
  const socket: Socket = createSocket('udp4')
  const requests: FakePcpServer['requests'] = []
  const mappings = new Map<string, number>()
  let dropped = 0

  socket.on('message', (msg, rinfo) => {
    if (dropped < (options.dropFirst ?? 0)) {
      dropped++
      return
    }
    if (options.natPmpOnly) {
      const reply = Buffer.alloc(8)
      reply.writeUInt8(0, 0)
      reply.writeUInt8(0x80 | msg.readUInt8(1), 1)
      reply.writeUInt16BE(1, 2) // UNSUPP_VERSION
      socket.send(reply, rinfo.port, rinfo.address)
      return
    }
    const protocol = msg.readUInt8(36)
    const internalPort = msg.readUInt16BE(40)
    const suggested = msg.readUInt16BE(42)
    const lifetime = msg.readUInt32BE(4)
    requests.push({ protocol, internalPort, externalPort: suggested, lifetime })

    const assigned = options.assignPort ?? suggested
    const key = `${protocol}:${internalPort}`
    if (lifetime === 0) mappings.delete(key)
    else if (!options.resultCode) mappings.set(key, assigned)

    const reply = Buffer.alloc(60)
    reply.writeUInt8(2, 0)
    reply.writeUInt8(0x81, 1)
    reply.writeUInt8(options.resultCode ?? 0, 3)
    reply.writeUInt32BE(lifetime, 4)
    msg.copy(reply, 24, 24, 36) // nonce
    reply.writeUInt8(protocol, 36)
    reply.writeUInt16BE(internalPort, 40)
    reply.writeUInt16BE(lifetime === 0 ? 0 : assigned, 42)
    reply.writeUInt16BE(0xffff, 54)
    ;(options.externalAddress ?? '203.0.113.5')
      .split('.')
      .forEach((octet, i) => reply.writeUInt8(Number(octet), 56 + i))
    socket.send(reply, rinfo.port, rinfo.address)
  })

  await new Promise<void>((resolve) => {
    socket.bind(0, '127.0.0.1', resolve)
  })
  return {
    port: socket.address().port,
    requests,
    mappings,
    close: () =>
      new Promise((resolve) => {
        socket.close(() => {
          resolve()
        })
      }),
  }
}
