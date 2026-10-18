// One participant of the load test (PLAN #33): the app's own call code (Call) over a plain WSS
// connection, a fake microphone, and for one of them a fake 1080p «screen».
import type { MediaResponse, RoomEvent } from '@shared/room'
import { SCREEN_LAYERS } from '@shared/screen'
import {
  hostMessageSchema,
  parseMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
  type MediaRequest,
} from '@shared/signaling'
import { Call, createEventBuffer } from '../../src/renderer/src/room/call'

export interface ClientStats {
  bytesReceived: number
  bytesSent: number
  /** Round trip of the selected ICE pairs, ms. */
  rttMs: number[]
  /** Seconds of jitter buffer delay and emitted samples, summed over audio. */
  jitterBufferDelay: number
  jitterBufferEmitted: number
  audioConsumers: number
  /** Bytes received so far per incoming voice: only forwarded ones grow (#21). */
  audioBytes: Record<string, number>
  /** Voices with a packet in the last 300 ms right now: paused ones get none (#21). */
  voicesNow: number
  videoFramesDecoded: number
  videoBytesReceived: number
  videoBytesSent: number
  videoFramesEncoded: number
  protocol: string
  error?: string
}

const connections: RTCPeerConnection[] = []
const Original = window.RTCPeerConnection
window.RTCPeerConnection = class extends Original {
  constructor(config?: RTCConfiguration) {
    super(config)
    connections.push(this)
  }
}

const params = new URLSearchParams(location.search)
const url = params.get('url') ?? ''
const mediaHost = params.get('mediaHost') ?? '127.0.0.1'
const name = params.get('name') ?? 'Участник'
const shares = params.get('share') === '1'

/** Media goes where the organizer listens; the host only knows its own address. */
function pointAt(data: unknown): unknown {
  const parameters = data as { iceCandidates?: Record<string, unknown>[] }
  if (!Array.isArray(parameters.iceCandidates)) return data
  return {
    ...parameters,
    iceCandidates: parameters.iceCandidates.map((c) => ({
      ...c,
      ip: mediaHost,
      address: mediaHost,
    })),
  }
}

async function run(): Promise<void> {
  const socket = new WebSocket(url)
  const events = createEventBuffer()
  const pending = new Map<number, (response: MediaResponse) => void>()
  let nextId = 0
  const send = (message: ClientMessage): void => {
    socket.send(JSON.stringify(message))
  }
  const welcome = new Promise<Record<string, unknown>>((resolve, reject) => {
    socket.addEventListener('error', () => {
      reject(new Error('socket error'))
    })
    socket.addEventListener('open', () => {
      send({ type: 'hello', protocolVersion: PROTOCOL_VERSION })
    })
    socket.addEventListener('message', (frame) => {
      const message = parseMessage(hostMessageSchema, frame.data)
      if (!message) return
      switch (message.type) {
        case 'challenge':
          send({ type: 'auth', name, hmac: null })
          return
        case 'welcome':
          resolve(message.routerRtpCapabilities)
          return
        case 'response': {
          const answer = pending.get(message.id)
          pending.delete(message.id)
          answer?.(
            message.error === undefined
              ? { ok: true, data: message.data }
              : { ok: false, error: message.error },
          )
          return
        }
        case 'error':
          reject(new Error(message.code))
          return
        default:
          events.push(message as RoomEvent)
      }
    })
  })
  const request = (media: MediaRequest): Promise<MediaResponse> =>
    new Promise((resolve) => {
      const id = nextId++
      pending.set(id, (response) => {
        resolve(
          response.ok && media.method === 'createTransport'
            ? { ok: true, data: pointAt(response.data) }
            : response,
        )
      })
      send({ type: 'request', id, request: media })
    })

  const routerRtpCapabilities = await welcome
  const microphone = (
    await navigator.mediaDevices.getUserMedia({ audio: true })
  ).getAudioTracks()[0]
  let audioConsumers = 0
  const players = new Map<string, HTMLAudioElement>()
  const call = await Call.start({
    routerRtpCapabilities,
    events,
    request,
    microphone: microphone ?? null,
    muted: false,
    onRemoteAudio: (voices) => {
      audioConsumers = voices.length
      // Played (at zero volume) like in the app, so Chromium decodes them and keeps a jitter
      // buffer — otherwise playout numbers stay empty.
      for (const voice of voices) {
        if (players.has(voice.consumerId)) continue
        const player = new Audio()
        player.srcObject = new MediaStream([voice.track])
        player.volume = 0
        void player.play().catch(() => undefined)
        players.set(voice.consumerId, player)
      }
    },
  })
  if (shares) {
    const screen = await navigator.mediaDevices.getUserMedia({
      video: { width: 1920, height: SCREEN_LAYERS.high, frameRate: 30 },
    })
    const track = screen.getVideoTracks()[0]
    if (track) await call.startScreen(track, 'motion')
  }

  window.loadClient = {
    stats: async (): Promise<ClientStats> => {
      const result: ClientStats = {
        bytesReceived: 0,
        bytesSent: 0,
        rttMs: [],
        jitterBufferDelay: 0,
        jitterBufferEmitted: 0,
        audioConsumers,
        audioBytes: {},
        voicesNow: 0,
        videoFramesDecoded: 0,
        videoBytesReceived: 0,
        videoBytesSent: 0,
        videoFramesEncoded: 0,
        protocol: '',
      }
      for (const pc of connections) {
        const stats = [...(await pc.getStats()).values()] as Record<
          string,
          number | string | boolean
        >[]
        const byId = new Map(stats.map((s) => [s['id'], s]))
        for (const s of stats) {
          if (s['type'] === 'inbound-rtp' && s['mid'] !== 'probator') {
            result.bytesReceived += Number(s['bytesReceived'] ?? 0)
            if (s['kind'] === 'audio') {
              result.jitterBufferDelay += Number(s['jitterBufferDelay'] ?? 0)
              result.jitterBufferEmitted += Number(s['jitterBufferEmittedCount'] ?? 0)
              result.audioBytes[String(s['ssrc'])] = Number(s['bytesReceived'] ?? 0)
              const last = Number(s['lastPacketReceivedTimestamp'] ?? 0)
              if (last > 0 && Number(s['timestamp']) - last < 300) result.voicesNow++
            } else {
              result.videoFramesDecoded += Number(s['framesDecoded'] ?? 0)
              result.videoBytesReceived += Number(s['bytesReceived'] ?? 0)
            }
          }
          if (s['type'] === 'outbound-rtp') {
            result.bytesSent += Number(s['bytesSent'] ?? 0)
            if (s['kind'] === 'video') {
              result.videoBytesSent += Number(s['bytesSent'] ?? 0)
              result.videoFramesEncoded += Number(s['framesEncoded'] ?? 0)
            }
          }
          if (s['type'] === 'transport' && s['selectedCandidatePairId']) {
            const pair = byId.get(s['selectedCandidatePairId'])
            if (pair?.['currentRoundTripTime'] !== undefined) {
              result.rttMs.push(Number(pair['currentRoundTripTime']) * 1000)
            }
            const local = pair ? byId.get(pair['localCandidateId']) : undefined
            result.protocol = String(local?.['protocol'] ?? '')
          }
        }
      }
      return result
    },
  }
}

declare global {
  interface Window {
    loadClient?: { stats(): Promise<ClientStats> }
    loadError?: string
  }
}

run().catch((error: unknown) => {
  window.loadError = String(error)
})
