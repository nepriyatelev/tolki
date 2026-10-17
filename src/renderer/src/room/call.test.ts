import { Device, FakeHandler, testFakeParameters } from 'mediasoup-client'
import { describe, expect, it, vi } from 'vitest'
import type { MediaResponse, RoomEvent } from '@shared/room'
import type { MediaRequest } from '@shared/signaling'
import { Call, collectRoomEvents, type RemoteAudio } from './call'

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
