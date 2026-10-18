import { createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js'
import type { ConnectionSample } from './call'
import {
  connectionLongText,
  connectionQuality,
  connectionShortText,
  type ConnectionQuality,
} from './connection-quality'
import './ConnectionIndicator.css'

/** How often the indicator refreshes. */
export const CONNECTION_INTERVAL_MS = 2000
/** How soon it asks again while there are no numbers yet (the call is starting). */
export const CONNECTION_RETRY_MS = 250

/**
 * The link to the organizer in the call header (PLAN #32): «24 мс · через организатора (UDP)»
 * with a coloured dot — mint when good, amber when fair, red when poor or gone.
 */
export function ConnectionIndicator(props: {
  sample: () => Promise<ConnectionSample | null>
  /** The link dropped and the app is reconnecting (PLAN #31). */
  offline: boolean
}): JSX.Element {
  const [quality, setQuality] = createSignal<ConnectionQuality | null>(null)

  onMount(() => {
    let previous: ConnectionSample | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    // Quickly until the call is up and the first numbers arrive, then every 2 s.
    const tick = (): void => {
      void props.sample().then((current) => {
        if (current) {
          setQuality(connectionQuality(previous, current))
          previous = current
        }
        timer = setTimeout(tick, current ? CONNECTION_INTERVAL_MS : CONNECTION_RETRY_MS)
      })
    }
    tick()
    onCleanup(() => {
      clearTimeout(timer)
    })
  })

  const level = (): string => (props.offline ? 'poor' : (quality()?.level ?? 'unknown'))
  const label = (): string => {
    if (props.offline) return 'Нет связи с организатором'
    const q = quality()
    return q ? connectionLongText(q) : 'Проверка связи…'
  }

  return (
    <span
      class={`connection connection--${level()}`}
      role="status"
      aria-label={label()}
      title={label()}
    >
      <span class="connection-dot" aria-hidden="true" />
      <Show when={!props.offline} fallback="Нет связи">
        {quality() ? connectionShortText(quality() as ConnectionQuality) : 'Проверка связи…'}
      </Show>
    </span>
  )
}
