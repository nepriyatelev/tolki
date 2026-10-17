import { randomBytes } from 'node:crypto'
import { createSocket } from 'node:dgram'

/** Port Control Protocol (RFC 6887) client, MAP opcode for IPv4 only. */

export const PCP_PORT = 5351
const VERSION = 2
const OPCODE_MAP = 1
const REQUEST_SIZE = 60
const RESPONSE_SIZE = 60

export type PcpProtocol = 'tcp' | 'udp'

export interface PcpMapRequest {
  gateway: string
  localAddress: string
  protocol: PcpProtocol
  internalPort: number
  /** 0 asks the server to pick; the result says what was assigned. */
  suggestedExternalPort: number
  /** Seconds; 0 deletes the mapping. */
  lifetime: number
  /** Must be reused to renew or delete a mapping. */
  nonce: Buffer
  serverPort?: number
  /** Delays between retransmissions; total time is their sum. */
  retryDelaysMs?: readonly number[]
}

export interface PcpMapResult {
  externalAddress: string
  externalPort: number
  lifetime: number
}

export class PcpError extends Error {
  constructor(
    /** 'no-response' | 'nat-pmp-only' | a PCP result code name. */
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'PcpError'
  }
}

const RESULT_CODES = [
  'SUCCESS',
  'UNSUPP_VERSION',
  'NOT_AUTHORIZED',
  'MALFORMED_REQUEST',
  'UNSUPP_OPCODE',
  'UNSUPP_OPTION',
  'MALFORMED_OPTION',
  'NETWORK_FAILURE',
  'NO_RESOURCES',
  'UNSUPP_PROTOCOL',
  'USER_EX_QUOTA',
  'CANNOT_PROVIDE_EXTERNAL',
  'ADDRESS_MISMATCH',
  'EXCESSIVE_REMOTE_PEERS',
] as const

export function newNonce(): Buffer {
  return randomBytes(12)
}

export function encodeMapRequest(request: PcpMapRequest): Buffer {
  const packet = Buffer.alloc(REQUEST_SIZE)
  packet.writeUInt8(VERSION, 0)
  packet.writeUInt8(OPCODE_MAP, 1) // R bit = 0 (request)
  packet.writeUInt32BE(request.lifetime, 4)
  writeMappedIPv4(packet, 8, request.localAddress)
  request.nonce.copy(packet, 24, 0, 12)
  packet.writeUInt8(request.protocol === 'tcp' ? 6 : 17, 36)
  packet.writeUInt16BE(request.internalPort, 40)
  packet.writeUInt16BE(request.suggestedExternalPort, 42)
  writeMappedIPv4(packet, 44, '0.0.0.0') // any external IPv4 address
  return packet
}

export function decodeMapResponse(packet: Buffer, request: PcpMapRequest): PcpMapResult | null {
  // NAT-PMP-only servers answer a PCP request with version 0 and UNSUPP_VERSION.
  if (packet.length >= 4 && packet.readUInt8(0) === 0) {
    throw new PcpError('nat-pmp-only', 'Gateway speaks NAT-PMP, not PCP')
  }
  if (packet.length < RESPONSE_SIZE) return null
  if (packet.readUInt8(0) !== VERSION || packet.readUInt8(1) !== (0x80 | OPCODE_MAP)) return null
  if (!packet.subarray(24, 36).equals(request.nonce)) return null // not our request

  const result = packet.readUInt8(3)
  if (result !== 0) {
    const name = RESULT_CODES[result] ?? `RESULT_${result}`
    throw new PcpError(name, `PCP MAP failed: ${name}`)
  }
  return {
    lifetime: packet.readUInt32BE(4),
    externalPort: packet.readUInt16BE(42),
    externalAddress: readMappedIPv4(packet, 44),
  }
}

/** Sends a MAP request with retransmissions and resolves with the server's answer. */
export function pcpMap(request: PcpMapRequest): Promise<PcpMapResult> {
  const delays = request.retryDelaysMs ?? [500, 1000, 1500]
  const packet = encodeMapRequest(request)

  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4')
    let attempt = 0
    let timer: NodeJS.Timeout | undefined

    const finish = (error: Error | null, result?: PcpMapResult): void => {
      clearTimeout(timer)
      socket.close()
      if (error) reject(error)
      else if (result) resolve(result)
    }

    const send = (): void => {
      socket.send(packet, request.serverPort ?? PCP_PORT, request.gateway)
      const delay = delays[attempt++]
      timer = setTimeout(() => {
        if (attempt < delays.length) send()
        else finish(new PcpError('no-response', 'No PCP response from the gateway'))
      }, delay)
    }

    socket.on('message', (message) => {
      try {
        const result = decodeMapResponse(message, request)
        if (result) finish(null, result)
      } catch (error) {
        finish(error as Error)
      }
    })
    socket.on('error', (error) => {
      finish(error)
    })
    socket.bind(0, request.localAddress, send)
  })
}

function writeMappedIPv4(packet: Buffer, offset: number, address: string): void {
  packet.fill(0, offset, offset + 10)
  packet.writeUInt16BE(0xffff, offset + 10)
  address.split('.').forEach((octet, i) => packet.writeUInt8(Number(octet), offset + 12 + i))
}

function readMappedIPv4(packet: Buffer, offset: number): string {
  return Array.from(packet.subarray(offset + 12, offset + 16)).join('.')
}
