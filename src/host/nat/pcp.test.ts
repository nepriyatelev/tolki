import { afterEach, describe, expect, it } from 'vitest'
import { startFakePcpServer, type FakePcpServer } from './fake-pcp-server'
import {
  decodeMapResponse,
  encodeMapRequest,
  newNonce,
  pcpMap,
  PcpError,
  type PcpMapRequest,
} from './pcp'
import { PcpStrategy, type NatProbe } from './strategies'
import { MethodUnavailableError } from './port-mapper'

let server: FakePcpServer | null = null

afterEach(async () => {
  await server?.close()
  server = null
})

function request(overrides: Partial<PcpMapRequest> = {}): PcpMapRequest {
  return {
    gateway: '127.0.0.1',
    localAddress: '127.0.0.1',
    protocol: 'tcp',
    internalPort: 47000,
    suggestedExternalPort: 47000,
    lifetime: 7200,
    nonce: newNonce(),
    retryDelaysMs: [100, 100],
    ...overrides,
  }
}

describe('PCP packets', () => {
  it('encodes a MAP request per RFC 6887', () => {
    const req = request({ protocol: 'udp', localAddress: '192.168.1.42' })
    const packet = encodeMapRequest(req)

    expect(packet.length).toBe(60)
    expect(packet.readUInt8(0)).toBe(2) // version
    expect(packet.readUInt8(1)).toBe(1) // MAP request
    expect(packet.readUInt32BE(4)).toBe(7200)
    expect(packet.subarray(8, 24).toString('hex')).toBe('00000000000000000000ffffc0a8012a')
    expect(packet.subarray(24, 36).equals(req.nonce)).toBe(true)
    expect(packet.readUInt8(36)).toBe(17) // UDP
    expect(packet.readUInt16BE(40)).toBe(47000)
    expect(packet.readUInt16BE(42)).toBe(47000)
    expect(packet.subarray(44, 60).toString('hex')).toBe('00000000000000000000ffff00000000')
  })

  it('ignores answers to other requests (different nonce)', () => {
    const req = request()
    const reply = Buffer.alloc(60)
    reply.writeUInt8(2, 0)
    reply.writeUInt8(0x81, 1)
    newNonce().copy(reply, 24)

    expect(decodeMapResponse(reply, req)).toBeNull()
  })
})

describe('pcpMap', () => {
  it('maps a port and returns the external address and port', async () => {
    server = await startFakePcpServer({ externalAddress: '198.51.100.7' })

    const result = await pcpMap(request({ serverPort: server.port }))

    expect(result).toEqual({ externalAddress: '198.51.100.7', externalPort: 47000, lifetime: 7200 })
    expect(server.mappings.get('6:47000')).toBe(47000)
  })

  it('retransmits when a request is lost', async () => {
    server = await startFakePcpServer({ dropFirst: 1 })

    await expect(
      pcpMap(request({ serverPort: server.port, retryDelaysMs: [50, 200] })),
    ).resolves.toMatchObject({ externalPort: 47000 })
    expect(server.requests).toHaveLength(1)
  })

  it('reports no-response when nobody answers', async () => {
    server = await startFakePcpServer({ dropFirst: 99 })

    await expect(pcpMap(request({ serverPort: server.port }))).rejects.toMatchObject({
      code: 'no-response',
    })
  })

  it('detects a NAT-PMP-only gateway', async () => {
    server = await startFakePcpServer({ natPmpOnly: true })

    await expect(pcpMap(request({ serverPort: server.port }))).rejects.toMatchObject({
      code: 'nat-pmp-only',
    })
  })

  it('surfaces PCP result codes', async () => {
    server = await startFakePcpServer({ resultCode: 2 })

    const error = await pcpMap(request({ serverPort: server.port })).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PcpError)
    expect((error as PcpError).code).toBe('NOT_AUTHORIZED')
  })
})

describe('PcpStrategy', () => {
  const gateway = { gateway: '127.0.0.1', localAddress: '127.0.0.1' }

  it('maps TCP and UDP and deletes both on close', async () => {
    server = await startFakePcpServer()
    const strategy = new PcpStrategy(gateway, {}, server.port)

    const mapped = await strategy.map(47000)
    expect(mapped).toEqual({
      externalAddress: '203.0.113.5',
      externalPort: 47000,
      externalUdpPort: 47000,
    })
    expect([...server.mappings.keys()].sort()).toEqual(['17:47000', '6:47000'])

    await strategy.close()
    expect(server.mappings.size).toBe(0)
    expect(server.requests.filter((r) => r.lifetime === 0)).toHaveLength(2)
  })

  it('reports the port the router actually assigned', async () => {
    server = await startFakePcpServer({ assignPort: 51234 })
    const strategy = new PcpStrategy(gateway, {}, server.port)

    await expect(strategy.map(47000)).resolves.toMatchObject({
      externalPort: 51234,
      externalUdpPort: 51234,
    })
    await strategy.close()
  })

  it('marks PCP unavailable and remembers a NAT-PMP-only gateway for the next strategy', async () => {
    server = await startFakePcpServer({ natPmpOnly: true })
    const probe: NatProbe = {}
    const strategy = new PcpStrategy(gateway, probe, server.port)

    await expect(strategy.map(47000)).rejects.toBeInstanceOf(MethodUnavailableError)
    expect(probe.pcp).toBe('nat-pmp-only')
  })

  it('treats a refusal as an error, not as unavailable', async () => {
    server = await startFakePcpServer({ resultCode: 8 })
    const strategy = new PcpStrategy(gateway, {}, server.port)

    const error = await strategy.map(47000).catch((e: unknown) => e)
    expect(error).not.toBeInstanceOf(MethodUnavailableError)
    expect((error as PcpError).code).toBe('NO_RESOURCES')
  })
})
