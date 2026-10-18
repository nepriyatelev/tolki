import { randomBytes } from 'node:crypto'
import { createSocket } from 'node:dgram'
import { isIPv4 } from 'node:net'

/** Cloudflare's public STUN server (#128): free, and Cloudflare already measures the upload. */
export const STUN_SERVER = { host: 'stun.cloudflare.com', port: 3478 }

const MAGIC_COOKIE = 0x2112a442
const BINDING_REQUEST = 0x0001
const BINDING_SUCCESS = 0x0101
const XOR_MAPPED_ADDRESS = 0x0020
const MAPPED_ADDRESS = 0x0001

/** A STUN Binding Request (RFC 5389) with a fresh transaction id. */
export function bindingRequest(transactionId: Buffer = randomBytes(12)): Buffer {
  const message = Buffer.alloc(20)
  message.writeUInt16BE(BINDING_REQUEST, 0)
  message.writeUInt16BE(0, 2)
  message.writeUInt32BE(MAGIC_COOKIE, 4)
  transactionId.copy(message, 8)
  return message
}

/** The IPv4 address the server saw us from, or null for anything else. */
export function parseBindingResponse(message: Buffer, transactionId: Buffer): string | null {
  if (message.length < 20 || message.readUInt16BE(0) !== BINDING_SUCCESS) return null
  if (message.readUInt32BE(4) !== MAGIC_COOKIE || !message.subarray(8, 20).equals(transactionId)) {
    return null
  }
  const end = Math.min(message.length, 20 + message.readUInt16BE(2))
  let mapped: string | null = null
  for (let offset = 20; offset + 4 <= end;) {
    const type = message.readUInt16BE(offset)
    const length = message.readUInt16BE(offset + 2)
    const value = message.subarray(offset + 4, offset + 4 + length)
    // Family 0x01 is IPv4: [reserved, family, port(2), address(4)].
    if (value.length >= 8 && value[1] === 0x01) {
      const address = [...value.subarray(4, 8)]
      if (type === XOR_MAPPED_ADDRESS) {
        const cookie = [0x21, 0x12, 0xa4, 0x42]
        return address.map((byte, i) => byte ^ (cookie[i] ?? 0)).join('.')
      }
      if (type === MAPPED_ADDRESS) mapped = address.join('.')
    }
    offset += 4 + length + ((4 - (length % 4)) % 4)
  }
  return mapped
}

/**
 * This computer's address as the internet sees it (#128), without asking the router. Null when
 * the server does not answer in time; never throws.
 */
export function stunPublicAddress(
  options: { host: string; port: number; timeoutMs?: number } = STUN_SERVER,
): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = createSocket('udp4')
    const transactionId = randomBytes(12)
    const request = bindingRequest(transactionId)
    let done = false
    const finish = (address: string | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      clearInterval(retry)
      socket.close()
      resolve(address !== null && isIPv4(address) ? address : null)
    }
    const timer = setTimeout(() => {
      finish(null)
    }, options.timeoutMs ?? 5000)
    const send = (): void => {
      socket.send(request, options.port, options.host, (error) => {
        if (error) finish(null)
      })
    }
    // UDP may lose the first try.
    const retry = setInterval(send, 1000)
    socket.on('error', () => {
      finish(null)
    })
    socket.on('message', (message) => {
      const address = parseBindingResponse(message, transactionId)
      if (address !== null) finish(address)
    })
    send()
  })
}
