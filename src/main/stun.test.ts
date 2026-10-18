import { createSocket, type Socket } from 'node:dgram'
import { afterEach, describe, expect, it } from 'vitest'
import { bindingRequest, parseBindingResponse, stunPublicAddress } from './stun'

/** A Binding Success Response carrying `address` as XOR-MAPPED-ADDRESS. */
function response(request: Buffer, address: string): Buffer {
  const message = Buffer.alloc(32)
  message.writeUInt16BE(0x0101, 0)
  message.writeUInt16BE(12, 2)
  request.copy(message, 4, 4, 20)
  message.writeUInt16BE(0x0020, 20)
  message.writeUInt16BE(8, 22)
  message[25] = 0x01
  message.writeUInt16BE(0x1234 ^ 0x2112, 26)
  const cookie = [0x21, 0x12, 0xa4, 0x42]
  address.split('.').forEach((part, i) => {
    message[28 + i] = Number(part) ^ (cookie[i] ?? 0)
  })
  return message
}

let server: Socket | null = null
afterEach(() => {
  server?.close()
  server = null
})

describe('STUN (#128)', () => {
  it('reads the address from a Binding Success Response of the same transaction', () => {
    const id = Buffer.alloc(12, 7)
    const request = bindingRequest(id)
    expect(parseBindingResponse(response(request, '93.184.216.34'), id)).toBe('93.184.216.34')
    expect(parseBindingResponse(response(request, '93.184.216.34'), Buffer.alloc(12, 8))).toBeNull()
    expect(parseBindingResponse(Buffer.from('nonsense'), id)).toBeNull()
  })

  it('asks a server over UDP and gives null when nobody answers', async () => {
    server = createSocket('udp4')
    server.on('message', (message, from) => {
      server?.send(response(message, '93.184.216.34'), from.port, from.address)
    })
    await new Promise<void>((resolve) => server?.bind(0, '127.0.0.1', resolve))
    const { port } = server.address()
    expect(await stunPublicAddress({ host: '127.0.0.1', port })).toBe('93.184.216.34')

    const silent = createSocket('udp4')
    await new Promise<void>((resolve) => silent.bind(0, '127.0.0.1', resolve))
    const quiet = silent.address().port
    expect(await stunPublicAddress({ host: '127.0.0.1', port: quiet, timeoutMs: 300 })).toBeNull()
    silent.close()
  })
})
