import { Device, type types } from 'mediasoup-client'
import type { MediaResponse, RoomEvent } from '@shared/room'
import type {
  MediaRequest,
  MediaResults,
  ScreenLayer,
  TransportParameters,
} from '@shared/signaling'
import {
  SCREEN_AUDIO,
  SCREEN_ENCODING,
  SCREEN_LAYERS,
  screenStreams,
  type ScreenMode,
} from '@shared/screen'
import type { ScreenBudget } from '@shared/upload-capacity'
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

/** Someone else's shared screen, ready to show (PLAN #28). */
export interface RemoteScreen {
  consumerId: string
  peerId: string
  track: MediaStreamTrack
}

/** A moment's numbers of a shared screen, for «1080p · 30 к/с · 2,8 Мбит/с» (PLAN #30). */
export interface ScreenSample {
  /** Height of the frames sent or received now. */
  height: number
  fps: number
  /** Total bytes so far; the bitrate comes from two samples. */
  bytes: number
  /** The encoder of the user's own screen, e.g. «VideoToolbox» (for the logs, #106). */
  encoder?: string
  /** Milliseconds. */
  timestamp: number
}

/** The link to the organizer at a moment (PLAN #32). */
export interface ConnectionSample {
  /** Round trip of the selected ICE pair, ms; null before one is selected. */
  rttMs: number | null
  /** How media reaches the organizer: UDP, or TCP when UDP is blocked. */
  protocol: 'udp' | 'tcp' | null
  /** Counters of everything received so far; loss comes from two samples. */
  packetsReceived: number
  packetsLost: number
}

/** Which of a shared screen's streams: 0 is ≈360p, 1 is ≈1080p (#34). */
export type { ScreenLayer }

/** Someone else's screen as received: one consumer per stream the host may send us. */
interface RemoteScreenState {
  /** Stable id of the screen for the UI: the consumer id of the first stream that came. */
  key: string
  peerId: string
  consumers: Map<ScreenLayer, types.Consumer>
  /** Shown to the user: hidden ones are not sent at all. */
  visible: boolean
  /** The stream asked for by the size it is shown at. */
  layer: ScreenLayer | null
}

/** A voice from someone else in the room, ready to play. */
export interface RemoteAudio {
  consumerId: string
  peerId: string
  track: MediaStreamTrack
  /** The sharer's computer sound with their screen (#41), not their voice. */
  screen?: boolean
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
    window.tolki.room.onEvent(listener),
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
  /** The screens others share changed (PLAN #28). */
  onRemoteScreens?: (screens: RemoteScreen[]) => void
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
  readonly #voices = new Map<
    string,
    { consumer: types.Consumer; peerId: string; screen: boolean }
  >()
  /** Screens by who shares them: a consumer per stream (≈1080p, ≈360p — #34). */
  readonly #screens = new Map<string, RemoteScreenState>()
  /** Which stream of the screen the host sends us now (`screen-layer`). */
  #screenLayer: ScreenLayer = 1
  #send: types.Transport | null = null
  #recv: types.Transport | null = null
  #producer: types.Producer | null = null
  /** The user's own screen: ≈1080p and ≈360p streams; the latter's track is ours to stop. */
  #screen: {
    high: types.Producer
    low: types.Producer | null
    lowTrack: MediaStreamTrack | null
    /** The computer's sound with the screen (#41). */
    audio: types.Producer | null
  } | null = null
  /** How the user's screen goes out: its mode and height, and the host's ceiling (#86). */
  #screenMode: ScreenMode = 'auto'
  #screenHeight: number = SCREEN_LAYERS.high
  #screenBudget: ScreenBudget | null = null
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
   * Push-to-talk (PLAN #39): the voice goes out only while the key is held. Only here, nothing
   * is asked of the host: the start of a phrase is not lost waiting for it, and others do not
   * see «микрофон выключен» flicker — they see the speaking frame, as with any voice.
   */
  setTransmitting(on: boolean): void {
    const producer = this.#producer
    if (!producer || this.#closed) return
    if (on) producer.resume()
    else producer.pause()
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
    this.#screen?.lowTrack?.stop()
    this.#send?.close()
    this.#recv?.close()
    this.#voices.clear()
    this.#screens.clear()
    this.options.onRemoteAudio([])
    this.options.onRemoteScreens?.([])
  }

  async #startReceiving(): Promise<void> {
    const parameters = await this.#request({ method: 'createTransport', direction: 'recv' })
    const transport = this.device.createRecvTransport(asTransportOptions(parameters))
    this.#recv = transport
    this.#connectOnDemand(transport)
    this.options.events.listen((event) => {
      if (this.#closed) return
      if (event.type === 'new-producer') {
        const layer = event.screenLayer ?? 1
        const screenAudio = event.screenAudio === true
        void this.#consume(transport, event.peerId, event.producerId, layer, screenAudio).catch(
          (error: unknown) => {
            console.warn('[call] could not receive a voice or screen:', error)
          },
        )
      } else if (event.type === 'consumer-closed') {
        this.#drop(event.consumerId)
      } else if (event.type === 'screen-layer') {
        this.#screenLayer = event.layer
        this.#publishScreens()
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
      transport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
        const { screenLayer, screenAudio } = appData as {
          screenLayer?: ScreenLayer
          screenAudio?: boolean
        }
        this.#request({
          method: 'produce',
          transportId: transport.id,
          kind,
          rtpParameters: { ...rtpParameters },
          ...(screenLayer !== undefined ? { screenLayer } : {}),
          ...(screenAudio === true ? { screenAudio: true as const } : {}),
        }).then(callback, errback)
      })
      return transport
    })()
    return this.#sending
  }

  /**
   * Sends the captured screen (PLAN #27, #34) as two streams: ≈1080p with H.264 when this
   * computer can (one stream, so it gets the hardware encoder), VP8 otherwise; and ≈360p with
   * VP8, cheap in software. Each viewer gets one of them. Sharpness or smoothness by the
   * room's mode. The track stays the caller's.
   */
  async startScreen(
    track: MediaStreamTrack,
    mode: ScreenMode,
    /** The computer's sound (#41): goes to every viewer, stereo, not among the voices. */
    audio: MediaStreamTrack | null = null,
  ): Promise<void> {
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
    const capabilities = this.device.sendRtpCapabilities
    const highCodec = preferredScreenCodec(capabilities)
    const lowCodec = capabilities.codecs?.find((c) => c.mimeType.toLowerCase() === 'video/vp8')
    this.#screenMode = mode
    this.#screenHeight = track.getSettings().height ?? SCREEN_LAYERS.high
    const streams = screenStreams(mode, this.#screenHeight, this.#screenBudget)
    const produce = (
      layer: ScreenLayer,
      source: MediaStreamTrack,
      codec: types.RtpCodecCapability | undefined,
    ) =>
      transport.produce({
        track: source,
        encodings: [layer === 1 ? streams.high : streams.low],
        ...(codec ? { codec } : {}),
        // Start at 1 Mbit/s instead of the browser's ~300 kbit/s: the first seconds of a shared
        // screen should already be readable.
        codecOptions: { videoGoogleStartBitrate: SCREEN_START_KBPS },
        stopTracks: false,
        appData: { source: 'screen', screenLayer: layer },
      })
    const high = await produce(1, track, highCodec)
    this.#screen = { high, low: null, lowTrack: null, audio: null }
    // A track of its own: senders of one track share the smallest frame rate asked for, and
    // ≈360p at 15 fps would hold ≈1080p to 15 fps too.
    const lowTrack = track.clone()
    // Without the small stream every viewer gets ≈1080p; the screen still works.
    const low = await produce(0, lowTrack, lowCodec ?? highCodec).catch((error: unknown) => {
      console.warn('[call] could not send the ≈360p screen stream:', error)
      return null
    })
    // Stopped (or started anew) meanwhile.
    if (!this.#isSending(high)) {
      low?.close()
      lowTrack.stop()
      return
    }
    this.#screen.low = low
    this.#screen.lowTrack = lowTrack
    if (!audio) return
    // Without the sound the screen still works.
    const sound = await transport
      .produce({
        track: audio,
        codecOptions: {
          opusStereo: SCREEN_AUDIO.stereo,
          opusMaxAverageBitrate: SCREEN_AUDIO.maxAverageBitrate,
          opusDtx: true,
          opusFec: true,
        },
        stopTracks: false,
        appData: { source: 'screen', screenAudio: true },
      })
      .catch((error: unknown) => {
        console.warn('[call] could not send the computer’s sound:', error)
        return null
      })
    if (!this.#isSending(high)) {
      sound?.close()
      return
    }
    this.#screen.audio = sound
  }

  /**
   * The host's ceiling for the big screen stream (#86): lower height and bitrate on the fly,
   * without sending it anew. Kept for a screen started later.
   */
  async setScreenBudget(budget: ScreenBudget): Promise<void> {
    this.#screenBudget = budget
    const high = this.#screen?.high
    if (!high || high.closed) return
    const encoding = screenStreams(this.#screenMode, this.#screenHeight, budget).high
    await high.setRtpEncodingParameters({
      maxBitrate: encoding.maxBitrate,
      scaleResolutionDownBy: encoding.scaleResolutionDownBy,
    })
  }

  /** Stops sending the screen; others' consumers of it end. */
  async stopScreen(): Promise<void> {
    const screen = this.#screen
    this.#screen = null
    screen?.lowTrack?.stop()
    for (const producer of [screen?.high, screen?.low, screen?.audio]) {
      if (!producer || producer.closed) continue
      producer.close()
      if (!this.#closed) await this.#request({ method: 'closeProducer', producerId: producer.id })
    }
  }

  /** «Показать свой»: asks whoever shares now to give way (PLAN #29). */
  async requestScreen(): Promise<void> {
    await this.#request({ method: 'requestScreen' })
  }

  /** The sharer's answer to someone's «Показать свой». */
  async answerScreenRequest(fromPeerId: string, accept: boolean): Promise<void> {
    await this.#request({ method: 'answerScreenRequest', fromPeerId, accept })
  }

  /**
   * Numbers of a screen: someone else's (by consumer) or the user's own (null). For the own one
   * the biggest layer being sent counts, and bytes of all layers add up.
   */
  async screenSample(consumerId: string | null): Promise<ScreenSample | null> {
    if (consumerId === null) {
      const own = [this.#screen?.high, this.#screen?.low].filter(
        (p): p is types.Producer => p !== undefined && p !== null && !p.closed,
      )
      if (own.length === 0) return null
      const reports = await Promise.all(own.map((p) => p.getStats()))
      return sampleOf(
        reports.flatMap((r) => [...r.values()] as unknown[]),
        'outbound-rtp',
      )
    }
    const consumer = this.#shownConsumer(this.#screenByKey(consumerId))
    if (!consumer || consumer.closed) return null
    return sampleOf([...(await consumer.getStats()).values()] as unknown[], 'inbound-rtp')
  }

  /** The link to the organizer, from the receive transport (always there, PLAN #32). */
  async connectionSample(): Promise<ConnectionSample | null> {
    const transport = this.#recv
    if (!transport || transport.closed || this.#closed) return null
    return connectionSampleOf(await transport.getStats())
  }

  /** The codec the screen goes out with, e.g. "video/H264"; null when not sharing. */
  get screenCodec(): string | null {
    return this.#screen?.high.rtpParameters.codecs[0]?.mimeType ?? null
  }

  /**
   * Media stalls while signalling still works (a changed network path): new ICE credentials let
   * the browser find a way again without rejoining (PLAN #31). «disconnected» often heals by
   * itself, so it gets a moment first; «failed» does not.
   */
  #restartIceWhenStuck(transport: types.Transport): void {
    let timer: ReturnType<typeof setTimeout> | undefined
    const restart = (): void => {
      if (this.#closed || transport.closed) return
      void this.#request({ method: 'restartIce', transportId: transport.id })
        .then(({ iceParameters }) =>
          transport.restartIce({ iceParameters: iceParameters as unknown as types.IceParameters }),
        )
        .catch((error: unknown) => {
          console.warn('[call] ICE restart failed:', error)
        })
    }
    transport.on('connectionstatechange', (state) => {
      // main writes the window's console.info to renderer.log (#106).
      console.info(`[call] ${transport.direction} transport ${state}`)
      clearTimeout(timer)
      if (state === 'failed') restart()
      else if (state === 'disconnected') timer = setTimeout(restart, ICE_RESTART_GRACE_MS)
    })
  }

  /** mediasoup-client asks for DTLS parameters on first use of a transport. */
  #connectOnDemand(transport: types.Transport): void {
    this.#restartIceWhenStuck(transport)
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

  async #consume(
    transport: types.Transport,
    peerId: string,
    producerId: string,
    layer: ScreenLayer,
    screenAudio = false,
  ): Promise<void> {
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
    if (consumer.kind === 'audio') {
      this.#voices.set(consumer.id, { consumer, peerId, screen: screenAudio })
      this.#publishVoices()
      return
    }
    let screen = this.#screens.get(peerId)
    if (!screen) {
      // The first stream to arrive names the screen for the UI, for as long as it is shared.
      screen = { key: consumer.id, peerId, consumers: new Map(), visible: true, layer: null }
      this.#screens.set(peerId, screen)
    }
    screen.consumers.set(layer, consumer)
    // Hidden before this stream arrived: it should not be sent either.
    if (!screen.visible) await this.#request({ method: 'pauseConsumer', consumerId: consumer.id })
    this.#publishScreens()
  }

  #screenByKey(key: string): RemoteScreenState | undefined {
    return [...this.#screens.values()].find((screen) => screen.key === key)
  }

  /** The stream the host sends now, or whichever there is. */
  #shownConsumer(screen: RemoteScreenState | undefined): types.Consumer | undefined {
    return screen?.consumers.get(this.#screenLayer) ?? screen?.consumers.values().next().value
  }

  /**
   * The viewer shows or hides a screen (window minimized, scrolled away): a hidden screen is not
   * sent at all, so nobody's upload is spent on it.
   */
  async setScreenVisible(consumerId: string, visible: boolean): Promise<void> {
    const screen = this.#screenByKey(consumerId)
    if (!screen || screen.visible === visible || this.#closed) return
    screen.visible = visible
    await Promise.all(
      [...screen.consumers.values()].map((consumer) =>
        this.#request({
          method: visible ? 'resumeConsumer' : 'pauseConsumer',
          consumerId: consumer.id,
        }),
      ),
    )
  }

  /** The stream that fits the size the screen is shown at; the host may still send ≈360p. */
  async setScreenLayer(consumerId: string, layer: ScreenLayer): Promise<void> {
    const screen = this.#screenByKey(consumerId)
    if (!screen || screen.layer === layer || this.#closed) return
    screen.layer = layer
    await this.#request({ method: 'setScreenLayer', layer })
  }

  /** A method, not the field: the screen may stop while a request is in flight. */
  #isSending(high: types.Producer): boolean {
    return this.#screen?.high === high
  }

  /** A method, not the field: the call may close while a request is in flight. */
  #isClosed(): boolean {
    return this.#closed
  }

  #drop(consumerId: string): void {
    const voice = this.#voices.get(consumerId)
    if (voice) {
      voice.consumer.close()
      this.#voices.delete(consumerId)
      this.#publishVoices()
    }
    for (const screen of this.#screens.values()) {
      for (const [layer, consumer] of screen.consumers) {
        if (consumer.id !== consumerId) continue
        consumer.close()
        screen.consumers.delete(layer)
        if (screen.consumers.size === 0) this.#screens.delete(screen.peerId)
        this.#publishScreens()
      }
    }
  }

  #publishScreens(): void {
    this.options.onRemoteScreens?.(
      [...this.#screens.values()].flatMap((screen) => {
        const consumer = this.#shownConsumer(screen)
        return consumer
          ? [{ consumerId: screen.key, peerId: screen.peerId, track: consumer.track }]
          : []
      }),
    )
  }

  #publishVoices(): void {
    this.options.onRemoteAudio(
      [...this.#voices.values()].map(({ consumer, peerId, screen }) => ({
        consumerId: consumer.id,
        peerId,
        track: consumer.track,
        ...(screen ? { screen: true } : {}),
      })),
    )
  }

  async #request<M extends MediaRequest['method']>(
    request: Extract<MediaRequest, { method: M }>,
  ): Promise<MediaResults[M]> {
    const send = this.options.request ?? ((r) => window.tolki.room.request(r))
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

/** How long a «disconnected» transport may heal by itself before an ICE restart. */
export const ICE_RESTART_GRACE_MS = 2000

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

interface RtpStat {
  type: string
  kind?: string
  mid?: string
  frameHeight?: number
  framesPerSecond?: number
  encoderImplementation?: string
  bytesSent?: number
  bytesReceived?: number
  timestamp: number
}

/** Folds an RTCStatsReport into one sample: the tallest layer, all bytes. */
export function sampleOf(
  report: RTCStatsReport | unknown[],
  type: 'inbound-rtp' | 'outbound-rtp',
): ScreenSample | null {
  // mediasoup's 'probator' only probes bandwidth.
  const all = Array.isArray(report) ? report : [...report.values()]
  const streams = (all as RtpStat[]).filter(
    (s) => s.type === type && s.kind === 'video' && s.mid !== 'probator',
  )
  if (streams.length === 0) return null
  const top = streams.reduce((a, b) => ((b.frameHeight ?? 0) > (a.frameHeight ?? 0) ? b : a))
  return {
    height: top.frameHeight ?? 0,
    fps: Math.round(top.framesPerSecond ?? 0),
    bytes: streams.reduce((sum, s) => sum + (s.bytesSent ?? s.bytesReceived ?? 0), 0),
    timestamp: top.timestamp,
    ...(top.encoderImplementation ? { encoder: top.encoderImplementation } : {}),
  }
}

interface LinkStat {
  type: string
  id: string
  kind?: string
  mid?: string
  selectedCandidatePairId?: string
  nominated?: boolean
  state?: string
  currentRoundTripTime?: number
  localCandidateId?: string
  protocol?: string
  packetsReceived?: number
  packetsLost?: number
}

/** The selected ICE pair's round trip and protocol, and packet counters of what arrives. */
export function connectionSampleOf(report: RTCStatsReport): ConnectionSample {
  const stats = [...report.values()] as LinkStat[]
  const byId = new Map(stats.map((s) => [s.id, s]))
  const selectedId = stats.find((s) => s.type === 'transport')?.selectedCandidatePairId
  const pair =
    (selectedId !== undefined ? byId.get(selectedId) : undefined) ??
    stats.find(
      (s) => s.type === 'candidate-pair' && s.nominated === true && s.state === 'succeeded',
    )
  const local = pair?.localCandidateId !== undefined ? byId.get(pair.localCandidateId) : undefined
  const inbound = stats.filter((s) => s.type === 'inbound-rtp' && s.mid !== 'probator')
  return {
    rttMs:
      pair?.currentRoundTripTime !== undefined
        ? Math.round(pair.currentRoundTripTime * 1000)
        : null,
    protocol: local?.protocol === 'udp' || local?.protocol === 'tcp' ? local.protocol : null,
    packetsReceived: inbound.reduce((sum, s) => sum + (s.packetsReceived ?? 0), 0),
    packetsLost: inbound.reduce((sum, s) => sum + Math.max(0, s.packetsLost ?? 0), 0),
  }
}
