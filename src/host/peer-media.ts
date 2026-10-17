import type { types } from 'mediasoup'
import type { MediaRequest, MediaResults } from '@shared/signaling'
import type { MediaServer, MediaTransport } from './media-server'

/** A request the host refuses; the message goes back to the client in `response.error`. */
export class MediaRequestError extends Error {
  override name = 'MediaRequestError'
}

/** One send and one receive transport per participant. */
const MAX_TRANSPORTS = 2
/** Microphone now, the screen with M3. */
const MAX_PRODUCERS = 2

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
}

/** A participant's transports, producers and consumers on the host's router. */
export class PeerMedia {
  readonly #transports = new Map<string, MediaTransport>()
  readonly #producers = new Map<string, types.Producer>()
  readonly #consumers = new Map<string, types.Consumer>()
  /** Consumers the client asked to resume: its side is ready to play. */
  readonly #ready = new Set<string>()

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
        const producer = await transport.produce({
          kind: request.kind,
          rtpParameters: request.rtpParameters as unknown as types.RtpParameters,
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
        await this.#apply(consumer)
        return {}
      }

      case 'pauseProducer':
        await this.#setPaused(request.producerId, true)
        return {}

      case 'resumeProducer':
        await this.#setPaused(request.producerId, false)
        return {}

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

  /** The forwarded voices changed: pause the ones not forwarded, resume the others. */
  async refresh(): Promise<void> {
    await Promise.all([...this.#consumers.values()].map((consumer) => this.#apply(consumer)))
  }

  async #apply(consumer: types.Consumer): Promise<void> {
    const run =
      this.#ready.has(consumer.id) &&
      (consumer.kind !== 'audio' || this.events.isForwarded(consumer.producerId))
    if (consumer.closed) return
    if (run && consumer.paused) await consumer.resume()
    else if (!run && !consumer.paused) await consumer.pause()
  }

  /** Closing the transports closes every producer and consumer on them. */
  close(): void {
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
