import type { types } from 'mediasoup'
import type { MediaRequest, MediaResults, ScreenLayer } from '@shared/signaling'
import type { MediaServer, MediaTransport } from './media-server'
import { ScreenLayerChoice } from './screen-layer'

/** A request the host refuses; the message goes back to the client in `response.error`. */
export class MediaRequestError extends Error {
  override name = 'MediaRequestError'
}

/** One send and one receive transport per participant. */
const MAX_TRANSPORTS = 2
/** The microphone, the screen's two streams (#34) and the computer's sound with it (#41). */
const MAX_PRODUCERS = 4

/** Which of the screen's streams a video producer is; the ≈1080p one unless told otherwise. */
/** The computer's sound shared with the screen (#41): forwarded to everyone, not a voice. */
export function isScreenAudio(producer: types.Producer): boolean {
  return (producer.appData as { screenAudio?: boolean }).screenAudio === true
}

export function screenLayerOf(producer: types.Producer): ScreenLayer {
  return (producer.appData as { screenLayer?: ScreenLayer }).screenLayer ?? 1
}

export interface PeerMediaEvents {
  /** The participant started sending; others should hear about it. */
  onProducer: (producer: types.Producer) => void
  /** Someone else's producer, if it exists. */
  findProducer: (producerId: string) => types.Producer | undefined
  /** A consumer ended because its producer did. */
  onConsumerClosed: (consumerId: string) => void
  /** Whether the host forwards this voice now (the three loudest, #21). */
  isForwarded: (producerId: string) => boolean
  /** The participant muted or unmuted a producer. */
  onProducerPaused: (producer: types.Producer, paused: boolean) => void
  /** Called before producing; throws to refuse (one screen at a time, PLAN #29). */
  beforeProduce: (kind: 'audio' | 'video', screenAudio: boolean) => void
  /** This viewer now gets another of the screen's streams (#34). */
  onScreenLayer: (layer: ScreenLayer) => void
}

/** A participant's transports, producers and consumers on the host's router. */
export class PeerMedia {
  readonly #transports = new Map<string, MediaTransport>()
  readonly #producers = new Map<string, types.Producer>()
  readonly #consumers = new Map<string, types.Consumer>()
  /** Consumers the client asked to resume: its side is ready to play. */
  readonly #ready = new Set<string>()
  readonly #screenLayer = new ScreenLayerChoice(() => {
    void this.refresh().catch(() => undefined)
  })
  /** The screen stream this viewer gets now, as last told to them. */
  #sentLayer: ScreenLayer | null = null

  constructor(
    private readonly server: MediaServer,
    private readonly events: PeerMediaEvents,
  ) {}

  get producers(): types.Producer[] {
    return [...this.#producers.values()]
  }

  get transports(): MediaTransport[] {
    return [...this.#transports.values()]
  }

  ownsProducer(producerId: string): boolean {
    return this.#producers.has(producerId)
  }

  async handle<M extends MediaRequest['method']>(
    request: Extract<MediaRequest, { method: M }>,
  ): Promise<MediaResults[M]>
  async handle(request: MediaRequest): Promise<MediaResults[MediaRequest['method']]> {
    switch (request.method) {
      case 'createTransport': {
        if (this.#transports.size >= MAX_TRANSPORTS) {
          throw new MediaRequestError('too many transports')
        }
        const transport = await this.server.createTransport(request.direction)
        this.#transports.set(transport.id, transport)
        if (request.direction === 'recv') this.#watchBandwidth(transport)
        return this.server.parametersOf(transport)
      }

      case 'connectTransport':
        await this.#transport(request.transportId).connect({
          dtlsParameters: request.dtlsParameters as unknown as types.DtlsParameters,
        })
        return {}

      case 'produce': {
        const transport = this.#transport(request.transportId, 'send')
        if (this.#producers.size >= MAX_PRODUCERS) throw new MediaRequestError('too many producers')
        const screenAudio = request.kind === 'audio' && request.screenAudio === true
        this.events.beforeProduce(request.kind, screenAudio)
        const producer = await transport.produce({
          kind: request.kind,
          rtpParameters: request.rtpParameters as unknown as types.RtpParameters,
          appData:
            request.kind === 'video'
              ? { screenLayer: request.screenLayer ?? 1 }
              : screenAudio
                ? { screenAudio: true }
                : {},
        })
        this.#producers.set(producer.id, producer)
        producer.observer.on('close', () => this.#producers.delete(producer.id))
        this.events.onProducer(producer)
        return { id: producer.id }
      }

      case 'consume': {
        const transport = this.#transport(request.transportId, 'recv')
        const rtpCapabilities = request.rtpCapabilities as unknown as types.RtpCapabilities
        const producer = this.events.findProducer(request.producerId)
        if (!producer || this.ownsProducer(producer.id)) {
          throw new MediaRequestError('unknown producer')
        }
        // One consumer per voice: repeated requests must not pile up work on the host.
        if ([...this.#consumers.values()].some((c) => c.producerId === producer.id)) {
          throw new MediaRequestError('already consuming')
        }
        if (!this.server.router.canConsume({ producerId: producer.id, rtpCapabilities })) {
          throw new MediaRequestError('cannot consume with these capabilities')
        }
        const consumer = await transport.consume({
          producerId: producer.id,
          rtpCapabilities,
          paused: true,
        })
        this.#consumers.set(consumer.id, consumer)
        consumer.observer.on('close', () => {
          this.#consumers.delete(consumer.id)
          this.#ready.delete(consumer.id)
          if (consumer.kind === 'video') void this.refresh().catch(() => undefined)
        })
        consumer.on('producerclose', () => {
          this.events.onConsumerClosed(consumer.id)
        })
        return {
          id: consumer.id,
          producerId: producer.id,
          kind: consumer.kind,
          rtpParameters: { ...consumer.rtpParameters },
        }
      }

      case 'resumeConsumer': {
        const consumer = this.#consumers.get(request.consumerId)
        if (!consumer) throw new MediaRequestError('unknown consumer')
        this.#ready.add(consumer.id)
        await this.refresh()
        return {}
      }

      case 'pauseConsumer': {
        const consumer = this.#consumers.get(request.consumerId)
        if (!consumer) throw new MediaRequestError('unknown consumer')
        this.#ready.delete(consumer.id)
        await this.#apply(consumer)
        return {}
      }

      case 'setScreenLayer':
        this.#screenLayer.prefer(request.layer)
        return {}

      case 'pauseProducer':
        await this.#setPaused(request.producerId, true)
        return {}

      case 'resumeProducer':
        await this.#setPaused(request.producerId, false)
        return {}

      case 'restartIce': {
        const iceParameters = await this.#transport(request.transportId).restartIce()
        return { iceParameters: { ...iceParameters } }
      }

      case 'requestScreen':
      case 'answerScreenRequest':
      case 'removePeer':
      case 'answerJoin':
      case 'setApproval':
      case 'sendChat':
        // Room matters, not media; the Room answers these before they get here.
        throw new MediaRequestError('not a media request')

      case 'closeProducer': {
        const producer = this.#producers.get(request.producerId)
        if (!producer) throw new MediaRequestError('unknown producer')
        // Consumers of it end with 'producerclose'; their owners get consumer-closed.
        producer.close()
        return {}
      }
    }
  }

  async #setPaused(producerId: string, paused: boolean): Promise<void> {
    const producer = this.#producers.get(producerId)
    if (!producer) throw new MediaRequestError('unknown producer')
    if (paused) await producer.pause()
    else await producer.resume()
    this.events.onProducerPaused(producer, paused)
  }

  /**
   * The forwarded voices or the screen stream for this viewer changed: pause what they should
   * not get, resume the rest.
   */
  async refresh(): Promise<void> {
    const layer = this.#currentScreenLayer()
    if (layer !== null && layer !== this.#sentLayer) this.events.onScreenLayer(layer)
    this.#sentLayer = layer
    await Promise.all([...this.#consumers.values()].map((consumer) => this.#apply(consumer)))
  }

  /** Of the screen streams this viewer consumes, the one to send them. */
  #currentScreenLayer(): ScreenLayer | null {
    const available = new Set<ScreenLayer>()
    for (const consumer of this.#consumers.values()) {
      const producer =
        consumer.kind === 'video' ? this.events.findProducer(consumer.producerId) : undefined
      if (producer) available.add(screenLayerOf(producer))
    }
    return this.#screenLayer.pick(available)
  }

  /** The receive side's bandwidth estimate decides whether ≈1080p fits (#34). */
  #watchBandwidth(transport: MediaTransport): void {
    void transport.enableTraceEvent(['bwe']).catch(() => undefined)
    transport.on('trace', (trace) => {
      if (trace.type !== 'bwe' || this.#sentLayer !== 1) return
      const watching = [...this.#consumers.values()].some(
        (c) => c.kind === 'video' && !c.paused && this.#ready.has(c.id),
      )
      const { availableBitrate } = trace.info as { availableBitrate?: number }
      if (watching && availableBitrate !== undefined) this.#screenLayer.estimate(availableBitrate)
    })
  }

  async #apply(consumer: types.Consumer): Promise<void> {
    const producer = this.events.findProducer(consumer.producerId)
    const run =
      this.#ready.has(consumer.id) &&
      (consumer.kind === 'audio'
        ? // The screen's sound goes to everyone; voices only when among the loudest (#21).
          (producer !== undefined && isScreenAudio(producer)) ||
          this.events.isForwarded(consumer.producerId)
        : producer !== undefined && screenLayerOf(producer) === this.#sentLayer)
    if (consumer.closed) return
    try {
      if (run && consumer.paused) await consumer.resume()
      else if (!run && !consumer.paused) await consumer.pause()
    } catch (error) {
      // It closed meanwhile (its owner left): nothing to pause any more.
      if (!isClosed(consumer)) throw error
    }
  }

  /** Closing the transports closes every producer and consumer on them. */
  close(): void {
    this.#screenLayer.close()
    for (const transport of this.#transports.values()) transport.close()
    this.#transports.clear()
  }

  #transport(id: string, direction?: 'send' | 'recv'): MediaTransport {
    const transport = this.#transports.get(id)
    if (!transport) throw new MediaRequestError('unknown transport')
    if (direction && transport.appData.direction !== direction) {
      throw new MediaRequestError(`not a ${direction} transport`)
    }
    return transport
  }
}

/** Read again after an await: the narrowing from before it no longer holds. */
function isClosed(consumer: types.Consumer): boolean {
  return consumer.closed
}
