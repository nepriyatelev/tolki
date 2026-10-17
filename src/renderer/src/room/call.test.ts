import { Device, FakeHandler, testFakeParameters } from 'mediasoup-client'
import { describe, expect, it, vi } from 'vitest'
import type { MediaResponse, RoomEvent } from '@shared/room'
import type { MediaRequest } from '@shared/signaling'
import { Call, collectRoomEvents, preferredScreenCodec, type RemoteAudio } from './call'

function fakeEvents() {
  let emit: (event: RoomEvent) => void = () => undefined
  const unsubscribe = vi.fn()
  const source = collectRoomEvents((listener) => {
    emit = listener
    return unsubscribe
  })
  return {
    source,
    emit: (event: RoomEvent) => {
      emit(event)
    },
    unsubscribe,
  }
}

/** Answers like the host would, with mediasoup-client's fake parameters. */
function fakeHost() {
  const requests: MediaRequest[] = []
  let produced = 0
  const request = vi.fn((r: MediaRequest): Promise<MediaResponse> => {
    requests.push(r)
    switch (r.method) {
      case 'createTransport':
        return Promise.resolve({
          ok: true,
          data: testFakeParameters.generateTransportRemoteParameters(),
        })
      case 'produce':
        return Promise.resolve({ ok: true, data: { id: `producer-${++produced}` } })
      case 'consume': {
        const consumer = testFakeParameters.generateConsumerRemoteParameters({
          codecMimeType: 'audio/opus',
        })
        return Promise.resolve({
          ok: true,
          data: { ...consumer, producerId: r.producerId, kind: 'audio' },
        })
      }
      default:
        return Promise.resolve({ ok: true, data: {} })
    }
  })
  return { request, methods: () => requests.map((r) => r.method) }
}

function fakeTrack(): MediaStreamTrack {
  const track = {
    id: 'mic',
    kind: 'audio',
    enabled: true,
    readyState: 'live',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    stop: vi.fn(),
  }
  return { ...track, clone: () => ({ ...track }) } as unknown as MediaStreamTrack
}

const createDevice = () =>
  new Device({ handlerFactory: FakeHandler.createFactory(testFakeParameters) })

async function start(options: { microphone?: MediaStreamTrack | null; muted?: boolean } = {}) {
  const host = fakeHost()
  const events = fakeEvents()
  const onRemoteAudio = vi.fn<(voices: RemoteAudio[]) => void>()
  const call = await Call.start({
    routerRtpCapabilities: { ...testFakeParameters.generateRouterRtpCapabilities() },
    events: events.source,
    request: host.request,
    microphone: options.microphone === undefined ? fakeTrack() : options.microphone,
    muted: options.muted ?? false,
    onRemoteAudio,
    createDevice,
  })
  return { call, host, events, onRemoteAudio }
}

function fakeScreenTrack(height = 1080) {
  const applyConstraints = vi.fn(() => Promise.resolve())
  const track = {
    id: 'screen',
    kind: 'video',
    enabled: true,
    readyState: 'live',
    contentHint: '',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    stop: vi.fn(),
    applyConstraints,
    getSettings: () => ({ height }),
  }
  const fake = Object.assign(track, { clone: () => ({ ...track }) }) as unknown as MediaStreamTrack
  return { track: fake, applyConstraints }
}

describe('Call', () => {
  it('receives on one transport and sends the microphone on another', async () => {
    const { call, host } = await start()

    expect(call.producing).toBe(true)
    expect(host.methods()).toEqual([
      'createTransport',
      'createTransport',
      'connectTransport',
      'produce',
    ])
    expect(host.request.mock.calls[3]?.[0]).toMatchObject({ method: 'produce', kind: 'audio' })
  })

  it('mutes by pausing the producer here and on the host', async () => {
    const { call, host } = await start()

    await call.setMuted(true)
    await call.setMuted(false)

    expect(host.request.mock.calls.slice(-2).map((c) => c[0])).toEqual([
      { method: 'pauseProducer', producerId: 'producer-1' },
      { method: 'resumeProducer', producerId: 'producer-1' },
    ])
  })

  it('joins muted with the producer paused on the host', async () => {
    const { host } = await start({ muted: true })
    expect(host.methods().at(-1)).toBe('pauseProducer')
  })

  it('swaps the microphone without new requests to the host', async () => {
    const { call, host } = await start()
    const before = host.request.mock.calls.length

    await call.replaceMicrophone(fakeTrack())

    expect(host.request.mock.calls.length).toBe(before)
  })

  it('encodes the voice as mono Opus, ~40 kbit/s, with DTX and FEC', async () => {
    const device = createDevice()
    const produced: unknown[] = []
    const createSendTransport = device.createSendTransport.bind(device)
    vi.spyOn(device, 'createSendTransport').mockImplementation((options) => {
      const transport = createSendTransport(options)
      const produce = transport.produce.bind(transport)
      vi.spyOn(transport, 'produce').mockImplementation((args) => {
        produced.push(args)
        return produce(args)
      })
      return transport
    })

    await Call.start({
      routerRtpCapabilities: { ...testFakeParameters.generateRouterRtpCapabilities() },
      events: fakeEvents().source,
      request: fakeHost().request,
      microphone: fakeTrack(),
      muted: false,
      onRemoteAudio: () => undefined,
      createDevice: () => device,
    })

    expect(produced[0]).toMatchObject({
      codecOptions: {
        opusStereo: false,
        opusDtx: true,
        opusFec: true,
        opusMaxAverageBitrate: 40_000,
        opusPtime: 20,
      },
    })
  })

  it('only listens without a microphone', async () => {
    const { call, host } = await start({ microphone: null })

    expect(call.producing).toBe(false)
    expect(host.methods()).toEqual(['createTransport'])
  })

  it('plays a new voice after consuming and resuming it, and drops it when it ends', async () => {
    const { host, events, onRemoteAudio } = await start()

    events.emit({ type: 'new-producer', peerId: 'dima', producerId: 'p1', kind: 'audio' })
    await vi.waitFor(() => {
      expect(onRemoteAudio).toHaveBeenLastCalledWith([
        expect.objectContaining({ peerId: 'dima' }) as RemoteAudio,
      ])
    })
    expect(host.methods().slice(-3)).toEqual(['consume', 'connectTransport', 'resumeConsumer'])
    const consumerId = onRemoteAudio.mock.lastCall?.[0][0]?.consumerId ?? ''

    events.emit({ type: 'consumer-closed', consumerId })
    expect(onRemoteAudio).toHaveBeenLastCalledWith([])
  })

  it('replays events that arrived before the call started', async () => {
    const host = fakeHost()
    const events = fakeEvents()
    events.emit({ type: 'new-producer', peerId: 'dima', producerId: 'p1', kind: 'audio' })
    const onRemoteAudio = vi.fn<(voices: RemoteAudio[]) => void>()

    await Call.start({
      routerRtpCapabilities: { ...testFakeParameters.generateRouterRtpCapabilities() },
      events: events.source,
      request: host.request,
      microphone: null,
      muted: false,
      onRemoteAudio,
      createDevice,
    })

    await vi.waitFor(() => {
      expect(onRemoteAudio).toHaveBeenLastCalledWith([
        expect.objectContaining({ peerId: 'dima' }) as RemoteAudio,
      ])
    })
  })

  it('fails when the host refuses, and stops listening to events', async () => {
    const events = fakeEvents()
    await expect(
      Call.start({
        routerRtpCapabilities: { ...testFakeParameters.generateRouterRtpCapabilities() },
        events: events.source,
        request: () => Promise.resolve({ ok: false, error: 'media is not available' }),
        microphone: null,
        muted: false,
        onRemoteAudio: () => undefined,
        createDevice,
      }),
    ).rejects.toThrow('createTransport: media is not available')
    expect(events.unsubscribe).toHaveBeenCalled()
  })

  it('closes everything on leave', async () => {
    const { call, events, onRemoteAudio } = await start()

    call.close()
    call.close()

    expect(events.unsubscribe).toHaveBeenCalledOnce()
    expect(onRemoteAudio).toHaveBeenLastCalledWith([])
  })
})

describe('sending the screen (#27)', () => {
  it('goes out as two layers in the preferred codec, tuned by the room mode', async () => {
    const { call, host } = await start()
    const { track, applyConstraints } = fakeScreenTrack(1080)

    await call.startScreen(track, 'text')

    expect(track.contentHint).toBe('detail')
    expect(applyConstraints).toHaveBeenCalledWith({
      width: { max: 1920 },
      height: { max: 1080 },
      frameRate: { max: 15 },
    })
    const produce = host.request.mock.calls
      .map((c) => c[0])
      .find((r) => r.method === 'produce' && r.kind === 'video')
    expect(produce).toBeDefined()
    const rtp = (produce as unknown as { rtpParameters: { encodings: { maxBitrate?: number }[] } })
      .rtpParameters
    // ≈360p at 500 kbit/s and ≈1080p at the text mode's 1.5 Mbit/s.
    expect(rtp.encodings.map((e) => e.maxBitrate)).toEqual([500_000, 1_500_000])
    expect(call.screenCodec).toMatch(/^video\//)
  })

  it('stops: closes the producer here and on the host', async () => {
    const { call, host } = await start({ microphone: null })
    await call.startScreen(fakeScreenTrack().track, 'motion')

    await call.stopScreen()

    expect(host.methods().at(-1)).toBe('closeProducer')
    expect(call.screenCodec).toBeNull()
    await call.stopScreen()
    expect(host.methods().filter((m) => m === 'closeProducer')).toHaveLength(1)
  })

  it('works without a microphone: the send transport is created for the screen', async () => {
    const { call, host } = await start({ microphone: null })
    await call.startScreen(fakeScreenTrack().track, 'auto')
    expect(host.methods().filter((m) => m === 'createTransport')).toHaveLength(2)
  })
})

describe('preferredScreenCodec', () => {
  const codec = (mimeType: string) => ({
    kind: mimeType.startsWith('audio') ? ('audio' as const) : ('video' as const),
    mimeType,
    clockRate: 90000,
    preferredPayloadType: 100,
  })

  it('prefers H.264, falls back to VP8, else nothing', () => {
    expect(
      preferredScreenCodec({
        codecs: [codec('audio/opus'), codec('video/VP8'), codec('video/H264')],
      })?.mimeType,
    ).toBe('video/H264')
    expect(preferredScreenCodec({ codecs: [codec('video/VP8')] })?.mimeType).toBe('video/VP8')
    expect(preferredScreenCodec({ codecs: [codec('audio/opus')] })).toBeUndefined()
  })
})
