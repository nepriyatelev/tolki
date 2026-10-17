import { onCleanup, onMount, type JSX } from 'solid-js'
import type { RemoteScreen, ScreenLayer } from './call'

/**
 * Shown taller than this on the display (in device pixels), the ≈1080p layer is worth its
 * bandwidth; smaller, ≈360p looks the same.
 */
export const HIGH_LAYER_MIN_HEIGHT = 540

/** The layer for a screen shown this tall (CSS pixels) on a display with this pixel ratio. */
export function layerForHeight(cssHeight: number, pixelRatio: number): ScreenLayer {
  return cssHeight * pixelRatio >= HIGH_LAYER_MIN_HEIGHT ? 1 : 0
}

/**
 * Someone else's screen (PLAN #28). It asks for the layer that fits its size and pauses itself
 * while nobody can see it: window minimized or hidden, tile scrolled out of view.
 */
export function RemoteScreenTile(props: {
  screen: RemoteScreen
  name: string
  onVisibleChange: (visible: boolean) => void
  onLayerChange: (layer: ScreenLayer) => void
}): JSX.Element {
  let tile: HTMLLIElement | undefined
  let video: HTMLVideoElement | undefined
  let inView = true

  const reportVisibility = (): void => {
    props.onVisibleChange(inView && document.visibilityState === 'visible')
  }

  onMount(() => {
    if (video) {
      const element = video
      element.srcObject = new MediaStream([props.screen.track])
      // Autoplay is allowed in the app; a refusal only means the next frame starts it.
      void Promise.resolve()
        .then(() => element.play())
        .catch(() => undefined)
    }
    document.addEventListener('visibilitychange', reportVisibility)
    onCleanup(() => {
      document.removeEventListener('visibilitychange', reportVisibility)
    })
    if (typeof IntersectionObserver !== 'undefined' && tile) {
      const observer = new IntersectionObserver(([entry]) => {
        inView = entry?.isIntersecting ?? true
        reportVisibility()
      })
      observer.observe(tile)
      onCleanup(() => {
        observer.disconnect()
      })
    }
    if (typeof ResizeObserver !== 'undefined' && video) {
      const observer = new ResizeObserver(([entry]) => {
        const height = entry?.contentRect.height ?? 0
        if (height > 0) props.onLayerChange(layerForHeight(height, window.devicePixelRatio))
      })
      observer.observe(video)
      onCleanup(() => {
        observer.disconnect()
      })
    }
  })

  return (
    <li
      ref={(element) => {
        tile = element
      }}
      class="call-tile call-tile--screen"
      aria-label={`Экран: ${props.name}`}
      data-consumer-id={props.screen.consumerId}
    >
      <video
        ref={(element) => {
          video = element
        }}
        class="call-screen-video"
        autoplay
        muted
        playsinline
      />
      <span class="call-tile-name">
        <span class="call-tile-name-text">Экран: {props.name}</span>
      </span>
    </li>
  )
}
