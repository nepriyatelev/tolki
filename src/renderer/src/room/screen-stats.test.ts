import { describe, expect, it } from 'vitest'
import { sampleOf } from './call'
import { screenStatsText } from './screen-stats'

describe('screenStatsText', () => {
  it('shows height and frame rate at once, the bitrate from the second sample on', () => {
    const first = { height: 1080, fps: 30, bytes: 1_000_000, timestamp: 0 }
    expect(screenStatsText(null, first)).toBe('1080p · 30 к/с')
    const second = { height: 1080, fps: 30, bytes: 1_350_000, timestamp: 1000 }
    expect(screenStatsText(first, second)).toBe('1080p · 30 к/с · 2,8 Мбит/с')
  })

  it('skips the bitrate when the counters went backwards', () => {
    const later = { height: 360, fps: 15, bytes: 10, timestamp: 2000 }
    expect(screenStatsText({ height: 360, fps: 15, bytes: 99, timestamp: 1000 }, later)).toBe(
      '360p · 15 к/с',
    )
  })
})

describe('sampleOf', () => {
  const report = (entries: Record<string, unknown>[]) =>
    new Map(entries.map((e, i) => [String(i), e])) as unknown as RTCStatsReport

  it('takes the tallest layer and adds up the bytes of all layers', () => {
    expect(
      sampleOf(
        report([
          {
            type: 'outbound-rtp',
            kind: 'video',
            frameHeight: 360,
            framesPerSecond: 15,
            bytesSent: 100,
            timestamp: 5,
          },
          {
            type: 'outbound-rtp',
            kind: 'video',
            frameHeight: 1080,
            framesPerSecond: 29.6,
            bytesSent: 900,
            timestamp: 5,
          },
          { type: 'outbound-rtp', kind: 'audio', bytesSent: 50, timestamp: 5 },
        ]),
        'outbound-rtp',
      ),
    ).toEqual({ height: 1080, fps: 30, bytes: 1000, timestamp: 5 })
  })

  it('ignores mediasoup’s probator and says nothing without video', () => {
    expect(
      sampleOf(
        report([
          { type: 'inbound-rtp', kind: 'video', mid: 'probator', bytesReceived: 9, timestamp: 1 },
          {
            type: 'inbound-rtp',
            kind: 'video',
            mid: '0',
            frameHeight: 340,
            framesPerSecond: 15,
            bytesReceived: 400,
            timestamp: 1,
          },
        ]),
        'inbound-rtp',
      ),
    ).toEqual({ height: 340, fps: 15, bytes: 400, timestamp: 1 })
    expect(sampleOf(report([]), 'inbound-rtp')).toBeNull()
  })
})
