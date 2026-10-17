import { Device, type types } from 'mediasoup-client'
import type { MediaResponse, RoomEvent } from '@shared/room'
import type { MediaRequest, MediaResults, TransportParameters } from '@shared/signaling'
import { SCREEN_ENCODING, SCREEN_LAYERS, screenEncodings, type ScreenMode } from '@shared/screen'
import { VOICE } from '@shared/voice'

/** How the microphone is encoded (PLAN #25). */
export const VOICE_CODEC_OPTIONS: types.ProducerCodecOptions = {
  opusStereo: false,
  opusDtx: VOICE.dtx,
  opusFec: VOICE.fec,
  opusMaxAverageBitrate: VOICE.maxAverageBitrate,
  opusMaxPlaybackRate: VOICE.sampleRate,
  opusPtime: VOICE.ptime,
}

/** A voice from someone else in the room, ready to play. */
export interface RemoteAudio {
  consumerId: string
  peerId: string
  track: MediaStreamTrack
}

/**
 * Room events, from before `join` resolves: the host announces voices that are already on right
 * after `welcome`, so subscribing has to come first.
 */
export interface RoomEventSource {
  /** Replays what arrived so far, then passes on new events. */
  listen(listener: (event: RoomEvent) => void): void
  stop(): void
}

/** A RoomEventSource fed by hand: buffers until someone listens. */
export function createEventBuffer(
  onStop: () => void = () => undefined,
): RoomEventSource & { push(event: RoomEvent): void } {
  const buffer: RoomEvent[] = []
  let current: ((event: RoomEvent) => void) | null = null
  return {
    push(event) {
      if (current) current(event)
      else buffer.push(event)
    },
    listen(listener) {
      current = listener
      for (const event of buffer.splice(0)) listener(event)
    },
    stop: onStop,
  }
}

/** Subscribes to main's room events now; they wait in a buffer until someone listens. */
export function collectRoomEvents(
  subscribe: (listener: (event: RoomEvent) => void) => () => void = (listener) =>
    window.ratatosk.room.onEvent(listener),
): RoomEventSource {
  let unsubscribe = (): void => undefined
  const source = createEventBuffer(() => {
    unsubscribe()
  })
  unsubscribe = subscribe((event) => {
    source.push(event)
  })
  return source
}

export interface CallOptions {
  routerRtpCapabilities: Record<string, unknown>
  events: RoomEventSource
  /** Media requests to the host (through main). */
  request?: (request: MediaRequest) => Promise<MediaResponse>
  /** Null: no microphone (denied or missing), the user only listens. */
  microphone: MediaStreamTrack | null
  /** Join muted: the producer starts paused. */
  muted: boolean
  /** The voices to play changed. */
  onRemoteAudio: (voices: RemoteAudio[]) => void
  /** Tests pass a Device with mediasoup-client's FakeHandler. */
  createDevice?: () => Device
}

export class CallError extends Error {
  override name = 'CallError'
}

/**
 * The renderer's side of a call (PLAN #20): a mediasoup Device with one send transport for the
 * microphone and one receive transport for everyone else's voices.
 */
export class Call {
  readonly #voices = new Map<string, { consumer: types.Consumer; peerId: string }>()
  #send: types.Transport | null = null
  #recv: types.Transport | null = null
  #producer: types.Producer | null = null
  #screen: types.Producer | null = null
  #sending: Promise<types.Transport> | null = null
  #closed = false

  private constructor(
    private readonly device: Device,
    private readonly options: CallOptions,
  ) {}

  static async start(options: CallOptions): Promise<Call> {
    const device = options.createDevice?.() ?? new Device()
    const call = new Call(device, options)
    try {
      await device.load({
        routerRtpCapabilities: options.routerRtpCapabilities,
      })
      await call.#startReceiving()
      if (options.microphone && device.canProduce('audio')) {
        await call.#startSending(options.microphone)
      }
    } catch (error) {
      call.close()
      throw error
    }
    return call
  }

  get producing(): boolean {
    return this.#producer !== null
  }

  /**
   * Mute stops sending (PLAN #22): the producer pauses here and on the host, which tells the
   * others. Without a microphone there is nothing to do.
   */
  async setMuted(muted: boolean): Promise<void> {
    const producer = this.#producer
    if (!producer || this.#closed) return
    if (muted) producer.pause()
    else producer.resume()
    await this.#request({
      method: muted ? 'pauseProducer' : 'resumeProducer',
      producerId: producer.id,
    })
  }

  /**
   * Another microphone, without reconnecting (PLAN #24). The producer keeps its id and
   * mute state; the old track is the caller's to stop.
   */
  async replaceMicrophone(track: MediaStreamTrack): Promise<void> {
    if (!this.#producer || this.#closed) return
    await this.#producer.replaceTrack({ track })
  }

  /** Stops sending and receiving; the microphone track is the caller's to stop. */
  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.options.events.stop()
    this.#send?.close()
    this.#recv?.close()
    this.#voices.clear()
    this.options.onRemoteAudio([])
  }

  async #startReceiving(): Promise<void> {
    const parameters = await this.#request({ method: 'createTransport', direction: 'recv' })
    const transport = this.device.createRecvTransport(asTransportOptions(parameters))
    this.#recv = transport
    this.#connectOnDemand(transport)
    this.options.events.listen((event) => {
      if (this.#closed) return
      if (event.type === 'new-producer' && event.kind === 'audio') {
        void this.#consume(transport, event.peerId, event.producerId).catch((error: unknown) => {
          console.warn('[call] could not receive a voice:', error)
        })
      } else if (event.type === 'consumer-closed') {
        this.#dropVoice(event.consumerId)
      }
    })
  }

  async #startSending(track: MediaStreamTrack): Promise<void> {
    const transport = await this.#sendTransport()
    this.#producer = await transport.produce({
      track,
      codecOptions: VOICE_CODEC_OPTIONS,
      // The microphone belongs to the caller (it also feeds the level meter).
      stopTracks: false,
      disableTrackOnPause: true,
    })
    if (this.options.muted) await this.setMuted(true)
  }

  /** One send transport for the microphone and the screen, created on first use. */
  #sendTransport(): Promise<types.Transport> {
    this.#sending ??= (async () => {
      const parameters = await this.#request({ method: 'createTransport', direction: 'send' })
      const transport = this.device.createSendTransport(asTransportOptions(parameters))
      this.#send = transport
      this.#connectOnDemand(transport)
      transport.on('produce', ({ kind, rtpParameters }, callback, errback) => {
        this.#request({
          method: 'produce',
          transportId: transport.id,
          kind,
          rtpParameters: { ...rtpParameters },
        }).then(callback, errback)
      })
      return transport
    })()
    return this.#sending
  }

  /**
   * Sends the captured screen (PLAN #27): two simulcast layers (≈1080p and ≈360p), H.264 when
   * this computer can (usually in hardware), VP8 otherwise; sharpness or smoothness by the
   * room's mode. The track stays the caller's.
   */
  async startScreen(track: MediaStreamTrack, mode: ScreenMode): Promise<void> {
    if (this.#closed) return
    await this.stopScreen()
    const { contentHint, frameRate } = SCREEN_ENCODING[mode]
    track.contentHint = contentHint
    await track
      .applyConstraints({
        width: { max: 1920 },
        height: { max: SCREEN_LAYERS.high },
        frameRate: { max: frameRate },
      })
      .catch(() => undefined)
    const transport = await this.#sendTransport()
    const codec = preferredScreenCodec(this.device.sendRtpCapabilities)
    this.#screen = await transport.produce({
      track,
      encodings: screenEncodings(mode, track.getSettings().height ?? SCREEN_LAYERS.high),
      ...(codec ? { codec } : {}),
      // Start at 1 Mbit/s instead of the browser's ~300 kbit/s: the first seconds of a shared
      // screen should already be readable.
      codecOptions: { videoGoogleStartBitrate: SCREEN_START_KBPS },
      stopTracks: false,
      appData: { source: 'screen' },
    })
  }

  /** Stops sending the screen; others' consumers of it end. */
  async stopScreen(): Promise<void> {
    const producer = this.#screen
    this.#screen = null
    if (!producer || producer.closed) return
    producer.close()
    if (!this.#closed) await this.#request({ method: 'closeProducer', producerId: producer.id })
  }

  /** The codec the screen goes out with, e.g. "video/H264"; null when not sharing. */
  get screenCodec(): string | null {
    return this.#screen?.rtpParameters.codecs[0]?.mimeType ?? null
  }

  /** mediasoup-client asks for DTLS parameters on first use of a transport. */
  #connectOnDemand(transport: types.Transport): void {
    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
      this.#request({
        method: 'connectTransport',
        transportId: transport.id,
        dtlsParameters: { ...dtlsParameters },
      }).then(() => {
        callback()
      }, errback)
    })
  }

  async #consume(transport: types.Transport, peerId: string, producerId: string): Promise<void> {
    const answer = await this.#request({
      method: 'consume',
      transportId: transport.id,
      producerId,
      rtpCapabilities: { ...this.device.recvRtpCapabilities },
    })
    if (this.#isClosed()) return
    const consumer = await transport.consume({
      id: answer.id,
      producerId: answer.producerId,
      kind: answer.kind,
      rtpParameters: answer.rtpParameters as unknown as types.RtpParameters,
    })
    // Consumers start paused on the host until our side is ready to play.
    await this.#request({ method: 'resumeConsumer', consumerId: consumer.id })
    if (this.#isClosed()) {
      consumer.close()
      return
    }
    this.#voices.set(consumer.id, { consumer, peerId })
    this.#publishVoices()
  }

  /** A method, not the field: the call may close while a request is in flight. */
  #isClosed(): boolean {
    return this.#closed
  }

  #dropVoice(consumerId: string): void {
    const voice = this.#voices.get(consumerId)
    if (!voice) return
    voice.consumer.close()
    this.#voices.delete(consumerId)
    this.#publishVoices()
  }

  #publishVoices(): void {
    this.options.onRemoteAudio(
      [...this.#voices.values()].map(({ consumer, peerId }) => ({
        consumerId: consumer.id,
        peerId,
        track: consumer.track,
      })),
    )
  }

  async #request<M extends MediaRequest['method']>(
    request: Extract<MediaRequest, { method: M }>,
  ): Promise<MediaResults[M]> {
    const send = this.options.request ?? ((r) => window.ratatosk.room.request(r))
    const response = await send(request)
    if (!response.ok) throw new CallError(`${request.method}: ${response.error}`)
    return response.data as MediaResults[M]
  }
}

function asTransportOptions(parameters: TransportParameters): types.TransportOptions {
  return {
    id: parameters.id,
    iceParameters: parameters.iceParameters as unknown as types.IceParameters,
    iceCandidates: parameters.iceCandidates as unknown as types.IceCandidate[],
    dtlsParameters: parameters.dtlsParameters as unknown as types.DtlsParameters,
  }
}

/** Initial bandwidth estimate for the screen, kbit/s. */
export const SCREEN_START_KBPS = 1000

/** H.264 first (hardware encoders), VP8 when the browser cannot send H.264 to this router. */
export function preferredScreenCodec(
  capabilities: types.RtpCapabilities,
): types.RtpCodecCapability | undefined {
  const video = (capabilities.codecs ?? []).filter((c) => c.kind === 'video')
  return (
    video.find((c) => c.mimeType.toLowerCase() === 'video/h264') ??
    video.find((c) => c.mimeType.toLowerCase() === 'video/vp8')
  )
}
