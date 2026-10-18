import { Device, FakeHandler, testFakeParameters, type types } from 'mediasoup-client'
import { describe, expect, it, vi } from 'vitest'
import type { MediaResponse, RoomEvent } from '@shared/room'
import type { MediaRequest } from '@shared/signaling'
import {
  Call,
  collectRoomEvents,
  preferredScreenCodec,
  type RemoteAudio,
  type RemoteScreen,
} from './call'

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
  const stop = vi.fn()
  const track = {
    id: 'screen',
    kind: 'video',
    enabled: true,
    readyState: 'live',
    contentHint: '',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    stop,
    applyConstraints,
    getSettings: () => ({ height }),
  }
  const fake = Object.assign(track, { clone: () => ({ ...track }) }) as unknown as MediaStreamTrack
  return { track: fake, applyConstraints, stop }
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

describe('sending the screen (#27, #34)', () => {
  it('goes out as a ≈1080p and a ≈360p stream, tuned by the room mode', async () => {
    const { call, host } = await start()
    const { track, applyConstraints } = fakeScreenTrack(1080)

    await call.startScreen(track, 'text')

    expect(track.contentHint).toBe('detail')
    expect(applyConstraints).toHaveBeenCalledWith({
      width: { max: 1920 },
      height: { max: 1080 },
      frameRate: { max: 15 },
    })
    type Produce = {
      screenLayer?: number
      rtpParameters: { codecs: { mimeType: string }[]; encodings: { maxBitrate?: number }[] }
    }
    const produced = host.request.mock.calls
      .map((c) => c[0])
      .filter((r) => r.method === 'produce' && r.kind === 'video') as unknown as Produce[]
    // Two streams, not simulcast: one encoding each, so ≈1080p can get the hardware encoder.
    expect(
      produced.map((p) => ({
        layer: p.screenLayer,
        codec: p.rtpParameters.codecs[0]?.mimeType,
        bitrates: p.rtpParameters.encodings.map((e) => e.maxBitrate),
      })),
    ).toEqual([
      // ≈1080p at the text mode's 1.5 Mbit/s, ≈360p in VP8 at 500 kbit/s.
      { layer: 1, codec: expect.stringMatching(/^video\//) as string, bitrates: [1_500_000] },
      { layer: 0, codec: 'video/VP8', bitrates: [500_000] },
    ])
    expect(call.screenCodec).toBe(produced[0]?.rtpParameters.codecs[0]?.mimeType)
  })

  it('starts the screen at 1 Mbit/s, not the browser default', async () => {
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
    const call = await Call.start({
      routerRtpCapabilities: { ...testFakeParameters.generateRouterRtpCapabilities() },
      events: fakeEvents().source,
      request: fakeHost().request,
      microphone: null,
      muted: false,
      onRemoteAudio: () => undefined,
      createDevice: () => device,
    })

    await call.startScreen(fakeScreenTrack().track, 'auto')

    expect(produced.at(-1)).toMatchObject({
      codecOptions: { videoGoogleStartBitrate: 1000 },
      appData: { source: 'screen' },
    })
  })

  it('stops: closes both streams here and on the host', async () => {
    const { call, host } = await start({ microphone: null })
    const { track, stop } = fakeScreenTrack()
    await call.startScreen(track, 'motion')

    await call.stopScreen()

    expect(host.methods().slice(-2)).toEqual(['closeProducer', 'closeProducer'])
    expect(call.screenCodec).toBeNull()
    // The ≈360p stream's own copy of the track is stopped; the caller's track is theirs.
    expect(stop).toHaveBeenCalledTimes(1)
    await call.stopScreen()
    expect(host.methods().filter((m) => m === 'closeProducer')).toHaveLength(2)
  })

  it('keeps to the organizer’s ceiling, before the screen starts and while it goes (#86)', async () => {
    const device = createDevice()
    const producers: types.Producer[] = []
    const createSendTransport = device.createSendTransport.bind(device)
    vi.spyOn(device, 'createSendTransport').mockImplementation((options) => {
      const transport = createSendTransport(options)
      const produce = transport.produce.bind(transport)
      vi.spyOn(transport, 'produce').mockImplementation(async (args) => {
        const producer = await produce(args)
        producers.push(producer)
        return producer
      })
      return transport
    })
    const host = fakeHost()
    const call = await Call.start({
      routerRtpCapabilities: { ...testFakeParameters.generateRouterRtpCapabilities() },
      events: fakeEvents().source,
      request: host.request,
      microphone: null,
      muted: false,
      onRemoteAudio: () => undefined,
      createDevice: () => device,
    })
    type Produce = { screenLayer?: number; rtpParameters: { encodings: { maxBitrate?: number }[] } }
    const bigStream = () =>
      (host.request.mock.calls.map((c) => c[0]) as unknown as Produce[]).filter(
        (r) => r.screenLayer === 1,
      )

    // Told before sharing: the screen starts at 720p and 1.5 Mbit/s instead of 2.8.
    await call.setScreenBudget({ height: 720, maxBitrate: 1_500_000 })
    await call.startScreen(fakeScreenTrack(1080).track, 'motion')
    expect(bigStream().at(-1)?.rtpParameters.encodings[0]?.maxBitrate).toBe(1_500_000)

    // Told while sharing: the big stream changes on the fly, nothing is sent anew.
    const big = producers[0]
    if (!big) throw new Error('no producer')
    const set = vi.spyOn(big, 'setRtpEncodingParameters').mockResolvedValue()
    const produced = bigStream().length
    await call.setScreenBudget({ height: 360, maxBitrate: 500_000 })
    expect(set).toHaveBeenCalledWith({ maxBitrate: 500_000, scaleResolutionDownBy: 3 })
    expect(bigStream()).toHaveLength(produced)
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

describe('receiving screens (#28)', () => {
  async function startWithScreen() {
    const host = fakeHost()
    const events = fakeEvents()
    const onRemoteScreens = vi.fn<(screens: RemoteScreen[]) => void>()
    const call = await Call.start({
      routerRtpCapabilities: { ...testFakeParameters.generateRouterRtpCapabilities() },
      events: events.source,
      request: host.request,
      microphone: null,
      muted: false,
      onRemoteAudio: () => undefined,
      onRemoteScreens,
      createDevice,
    })
    host.request.mockImplementation((r: MediaRequest) => {
      if (r.method === 'consume') {
        const consumer = testFakeParameters.generateConsumerRemoteParameters({
          codecMimeType: 'video/VP8',
        })
        return Promise.resolve({
          ok: true,
          data: { ...consumer, producerId: r.producerId, kind: 'video' },
        })
      }
      return Promise.resolve({ ok: true, data: {} })
    })
    events.emit({ type: 'new-producer', peerId: 'dima', producerId: 'screen-1', kind: 'video' })
    await vi.waitFor(() => {
      expect(onRemoteScreens).toHaveBeenLastCalledWith([
        expect.objectContaining({ peerId: 'dima' }) as RemoteScreen,
      ])
    })
    const consumerId = onRemoteScreens.mock.lastCall?.[0][0]?.consumerId ?? ''
    return { call, host, events, onRemoteScreens, consumerId }
  }

  it('shows another participant’s screen', async () => {
    const { host } = await startWithScreen()
    expect(host.request.mock.calls.map((c) => c[0].method)).toContain('resumeConsumer')
  })

  it('pauses a hidden screen and resumes it, without repeating requests', async () => {
    const { call, host, consumerId } = await startWithScreen()
    host.request.mockClear()

    await call.setScreenVisible(consumerId, false)
    await call.setScreenVisible(consumerId, false)
    await call.setScreenVisible(consumerId, true)

    expect(host.request.mock.calls.map((c) => c[0])).toEqual([
      { method: 'pauseConsumer', consumerId },
      { method: 'resumeConsumer', consumerId },
    ])
  })

  it('asks for the layer that fits, once per change', async () => {
    const { call, host, consumerId } = await startWithScreen()
    host.request.mockClear()

    await call.setScreenLayer(consumerId, 0)
    await call.setScreenLayer(consumerId, 0)
    await call.setScreenLayer(consumerId, 1)

    expect(host.request.mock.calls.map((c) => c[0])).toEqual([
      { method: 'setScreenLayer', layer: 0 },
      { method: 'setScreenLayer', layer: 1 },
    ])
  })

  it('takes both streams of a screen as one and shows the one the host sends (#34)', async () => {
    const { call, host, events, onRemoteScreens, consumerId } = await startWithScreen()
    const high = onRemoteScreens.mock.lastCall?.[0][0]?.track
    events.emit({
      type: 'new-producer',
      peerId: 'dima',
      producerId: 'screen-1-low',
      kind: 'video',
      screenLayer: 0,
    })
    await vi.waitFor(() => {
      expect(host.request.mock.calls.filter((c) => c[0].method === 'resumeConsumer')).toHaveLength(
        2,
      )
    })
    await Promise.resolve()
    expect(onRemoteScreens.mock.lastCall?.[0]).toEqual([
      { consumerId, peerId: 'dima', track: high },
    ])

    // The host sends ≈360p now: same screen, the other track.
    events.emit({ type: 'screen-layer', layer: 0 })
    const shown = onRemoteScreens.mock.lastCall?.[0][0]
    expect(shown?.consumerId).toBe(consumerId)
    expect(shown?.track).not.toBe(high)

    // Hiding it pauses both streams.
    host.request.mockClear()
    await call.setScreenVisible(consumerId, false)
    expect(host.request.mock.calls.map((c) => c[0].method)).toEqual([
      'pauseConsumer',
      'pauseConsumer',
    ])

    // One stream ends: the screen stays with the other.
    events.emit({ type: 'consumer-closed', consumerId })
    expect(onRemoteScreens.mock.lastCall?.[0]).toEqual([
      { consumerId, peerId: 'dima', track: shown?.track },
    ])
  })

  it('drops the screen when sharing ends', async () => {
    const { events, onRemoteScreens, consumerId } = await startWithScreen()
    events.emit({ type: 'consumer-closed', consumerId })
    expect(onRemoteScreens).toHaveBeenLastCalledWith([])
  })
})
