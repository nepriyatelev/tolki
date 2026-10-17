import { createEffect, For, onCleanup, type JSX } from 'solid-js'
import type { RemoteAudio as Voice } from './call'

/**
 * Plays everyone else's voices through WebAudio, so each one has its own gain (0–200 %, PLAN
 * #23) and deafening is one master gain. Nothing to see: the elements stay hidden.
 */
export function RemoteAudio(props: {
  voices: Voice[]
  deafened: boolean
  /** Percent, 100 by default. */
  volumeOf: (peerId: string) => number
  /** Speakers or headphones; empty: the system default (PLAN #24). */
  outputDeviceId: string
}): JSX.Element {
  // Created with the first voice: no audio machinery while alone in the room.
  let context: AudioContext | null = null
  let master: GainNode | null = null
  const output = (): { context: AudioContext; master: GainNode } => {
    if (!context || !master) {
      context = new AudioContext()
      master = context.createGain()
      master.connect(context.destination)
      master.gain.value = props.deafened ? 0 : 1
      routeTo(context, props.outputDeviceId)
    }
    return { context, master }
  }
  // A new output applies on the fly, without touching the call.
  createEffect(() => {
    const deviceId = props.outputDeviceId
    if (context) routeTo(context, deviceId)
  })
  createEffect(() => {
    const deafened = props.deafened
    if (master) master.gain.value = deafened ? 0 : 1
  })
  onCleanup(() => {
    void context?.close()
  })

  return (
    <div hidden>
      <For each={props.voices}>
        {(voice) => (
          <audio
            data-peer-id={voice.peerId}
            // Chromium only feeds a remote track into WebAudio while a media element plays it;
            // the element itself stays silent, WebAudio does the output.
            muted
            autoplay
            ref={(element) => {
              const stream = new MediaStream([voice.track])
              element.srcObject = stream
              void element.play().catch(() => undefined)
              const { context: ctx, master: out } = output()
              const source = ctx.createMediaStreamSource(stream)
              const gain = ctx.createGain()
              source.connect(gain).connect(out)
              void ctx.resume().catch(() => undefined)
              createEffect(() => {
                gain.gain.value = props.volumeOf(voice.peerId) / 100
              })
              onCleanup(() => {
                source.disconnect()
                gain.disconnect()
              })
            }}
          />
        )}
      </For>
    </div>
  )
}

function routeTo(context: AudioContext, deviceId: string): void {
  void context.setSinkId(deviceId).catch((error: unknown) => {
    console.warn('[call] could not switch the output device:', error)
  })
}
