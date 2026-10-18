import { describe, expect, it } from 'vitest'
import { connectionSampleOf } from './call'
import { connectionLongText, connectionQuality, connectionShortText } from './connection-quality'

const report = (entries: Record<string, unknown>[]) =>
  new Map(entries.map((e) => [String(e['id']), e])) as unknown as RTCStatsReport

describe('connectionSampleOf', () => {
  it('reads the selected pair’s round trip and protocol, and counts arriving packets', () => {
    expect(
      connectionSampleOf(
        report([
          { id: 'T', type: 'transport', selectedCandidatePairId: 'P2' },
          { id: 'P1', type: 'candidate-pair', currentRoundTripTime: 0.5, localCandidateId: 'L1' },
          { id: 'P2', type: 'candidate-pair', currentRoundTripTime: 0.024, localCandidateId: 'L2' },
          { id: 'L1', type: 'local-candidate', protocol: 'tcp' },
          { id: 'L2', type: 'local-candidate', protocol: 'udp' },
          { id: 'A', type: 'inbound-rtp', kind: 'audio', packetsReceived: 90, packetsLost: 2 },
          { id: 'V', type: 'inbound-rtp', kind: 'video', mid: 'probator', packetsReceived: 9 },
        ]),
      ),
    ).toEqual({ rttMs: 24, protocol: 'udp', packetsReceived: 90, packetsLost: 2 })
  })

  it('falls back to the nominated pair, and knows nothing before one exists', () => {
    expect(
      connectionSampleOf(
        report([
          {
            id: 'P',
            type: 'candidate-pair',
            nominated: true,
            state: 'succeeded',
            currentRoundTripTime: 0.1,
            localCandidateId: 'L',
          },
          { id: 'L', type: 'local-candidate', protocol: 'tcp' },
        ]),
      ),
    ).toMatchObject({ rttMs: 100, protocol: 'tcp' })
    expect(connectionSampleOf(report([]))).toEqual({
      rttMs: null,
      protocol: null,
      packetsReceived: 0,
      packetsLost: 0,
    })
  })
})

describe('connectionQuality', () => {
  const sample = (rttMs: number, packetsReceived: number, packetsLost: number) => ({
    rttMs,
    protocol: 'udp' as const,
    packetsReceived,
    packetsLost,
  })

  it('is good, fair or poor by round trip and loss over the last interval', () => {
    expect(connectionQuality(sample(30, 0, 0), sample(30, 100, 0)).level).toBe('good')
    expect(connectionQuality(sample(200, 0, 0), sample(200, 100, 0)).level).toBe('fair')
    expect(connectionQuality(sample(30, 0, 0), sample(30, 97, 3)).level).toBe('fair')
    expect(connectionQuality(sample(400, 0, 0), sample(400, 100, 0)).level).toBe('poor')
    expect(connectionQuality(sample(30, 0, 0), sample(30, 90, 10)).lossPercent).toBe(10)
  })

  it('counts no loss in silence and on the first sample', () => {
    expect(connectionQuality(sample(30, 100, 5), sample(30, 100, 5)).lossPercent).toBe(0)
    expect(connectionQuality(null, sample(30, 100, 50)).lossPercent).toBe(0)
  })

  it('says it the plan’s way: «через организатора», UDP or TCP', () => {
    const q = connectionQuality(sample(24, 0, 0), sample(24, 99, 1))
    expect(connectionShortText(q)).toBe('24 мс · через организатора (UDP)')
    expect(connectionLongText(q)).toBe(
      'Связь хорошая, задержка 24 мс, потери 1 %, через организатора по UDP',
    )
    expect(connectionShortText({ ...q, rttMs: null, protocol: null })).toBe('через организатора')
  })
})
