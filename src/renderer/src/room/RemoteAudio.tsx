import { For, type JSX } from 'solid-js'
import type { RemoteAudio as Voice } from './call'

/** Plays everyone else's voices, silenced while deafened. Nothing to see: the elements stay hidden. */
export function RemoteAudio(props: { voices: Voice[]; deafened: boolean }): JSX.Element {
  return (
    <div hidden>
      <For each={props.voices}>
        {(voice) => (
          <audio
            data-peer-id={voice.peerId}
            autoplay
            muted={props.deafened}
            ref={(element) => {
              element.srcObject = new MediaStream([voice.track])
              void element.play().catch(() => undefined)
            }}
          />
        )}
      </For>
    </div>
  )
}
