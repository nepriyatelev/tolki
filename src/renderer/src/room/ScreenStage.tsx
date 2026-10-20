import Maximize from 'lucide-solid/icons/maximize'
import Minimize from 'lucide-solid/icons/minimize'
import { createEffect, createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js'
import { Avatar, IconButton, liquidGlass } from '../ui'
import type { ScreenLayer, ScreenSample } from './call'
import { screenStatsText } from './screen-stats'
import './ScreenStage.css'

/**
 * Shown taller than this on the display (in device pixels), the ≈1080p layer is worth its
 * bandwidth; smaller, ≈360p looks the same.
 */
export const HIGH_LAYER_MIN_HEIGHT = 540

/** The layer for a screen shown this tall (CSS pixels) on a display with this pixel ratio. */
export function layerForHeight(cssHeight: number, pixelRatio: number): ScreenLayer {
  return cssHeight * pixelRatio >= HIGH_LAYER_MIN_HEIGHT ? 1 : 0
}

/** How often the numbers in the corner refresh. */
export const STATS_INTERVAL_MS = 1000

/** Without a mouse move this long, the chips over the screen and the cursor hide (#110). */
export const CHROME_HIDE_MS = 3000

/**
 * The shared screen, big (mockup 5, PLAN #30): who shares, «1080p · 30 к/с · 2,8 Мбит/с» on
 * hover, full screen by the button or a double click. The chips and the cursor hide when the mouse
 * rests (#110). Someone else's screen also asks for the layer that fits its size and pauses while
 * nobody sees it (window hidden, scrolled away, stage closed — PLAN #28).
 */
export function ScreenStage(props: {
  /** «Экран: Дима» or «Мой экран». */
  title: string
  /** Whose screen, for the avatar. */
  name: string
  stream: MediaStream
  /** Someone else's screen: its consumer; null for the user's own. */
  consumerId: string | null
  sample: (consumerId: string | null) => Promise<ScreenSample | null>
  /** Someone else's screen only: pause while hidden, pick the layer by size. */
  onVisibleChange?: (consumerId: string, visible: boolean) => void
  onLayerChange?: (consumerId: string, layer: ScreenLayer) => void
}): JSX.Element {
  let stage: HTMLElement | undefined
  let video: HTMLVideoElement | undefined
  let inView = true
  const [stats, setStats] = createSignal<string | null>(null)
  const [fullscreen, setFullscreen] = createSignal(false)
  const [idle, setIdle] = createSignal(false)
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const wake = (): void => {
    setIdle(false)
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => setIdle(true), CHROME_HIDE_MS)
  }

  // Kept here, not read from props: the stage may close (and props go stale) before cleanup.
  // The effect below fills them in right away and keeps them current.
  let consumerId: string | null = null
  let visibleChange: ((consumerId: string, visible: boolean) => void) | undefined
  createEffect(() => {
    consumerId = props.consumerId
    visibleChange = props.onVisibleChange
    if (video) video.srcObject = props.stream
  })

  const reportVisibility = (): void => {
    if (consumerId) visibleChange?.(consumerId, inView && document.visibilityState === 'visible')
  }

  onMount(() => {
    if (video) {
      const element = video
      element.srcObject = props.stream
      // Autoplay is allowed in the app; a refusal only means the next frame starts it.
      void Promise.resolve()
        .then(() => element.play())
        .catch(() => undefined)
    }

    document.addEventListener('visibilitychange', reportVisibility)
    const onFullscreen = (): void => {
      setFullscreen(document.fullscreenElement === stage)
    }
    document.addEventListener('fullscreenchange', onFullscreen)
    onCleanup(() => {
      document.removeEventListener('visibilitychange', reportVisibility)
      document.removeEventListener('fullscreenchange', onFullscreen)
      // The stage closes: nobody sees this screen any more.
      if (consumerId) visibleChange?.(consumerId, false)
    })
    reportVisibility()

    if (typeof IntersectionObserver !== 'undefined' && stage) {
      const observer = new IntersectionObserver(([entry]) => {
        inView = entry?.isIntersecting ?? true
        reportVisibility()
      })
      observer.observe(stage)
      onCleanup(() => {
        observer.disconnect()
      })
    }
    if (typeof ResizeObserver !== 'undefined' && video) {
      const observer = new ResizeObserver(([entry]) => {
        const height = entry?.contentRect.height ?? 0
        if (height > 0 && consumerId) {
          props.onLayerChange?.(consumerId, layerForHeight(height, window.devicePixelRatio))
        }
      })
      observer.observe(video)
      onCleanup(() => {
        observer.disconnect()
      })
    }

    let previous: ScreenSample | null = null
    const timer = setInterval(() => {
      void props.sample(consumerId).then((current) => {
        if (!current) return
        setStats(screenStatsText(previous, current))
        previous = current
      })
    }, STATS_INTERVAL_MS)
    onCleanup(() => {
      clearInterval(timer)
    })

    wake()
    onCleanup(() => {
      clearTimeout(idleTimer)
    })
  })

  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void stage?.requestFullscreen()
  }

  return (
    <section
      ref={(element) => {
        stage = element
      }}
      class="screen-stage"
      classList={{ 'screen-stage--idle': idle() }}
      aria-label={props.title}
      onPointerMove={wake}
      onPointerDown={wake}
      onKeyDown={wake}
      onDblClick={(event) => {
        // The chips have their own clicks; a double click on the picture is for full screen.
        if (event.target === video) toggleFullscreen()
      }}
    >
      <video
        ref={(element) => {
          video = element
        }}
        class="screen-stage-video"
        autoplay
        muted
        playsinline
      />
      <span
        ref={liquidGlass}
        class="screen-stage-chip screen-stage-who rt-glass rt-glass--sm rt-glass--liquid"
      >
        <Avatar name={props.name} size="xs" />
        {props.title}
      </span>
      <div class="screen-stage-corner">
        <Show when={stats()}>
          {(text) => (
            <span
              ref={liquidGlass}
              class="screen-stage-chip screen-stage-stats rt-glass rt-glass--sm rt-glass--liquid"
            >
              {text()}
            </span>
          )}
        </Show>
        <IconButton
          class="screen-stage-fullscreen rt-glass rt-glass--sm"
          label={fullscreen() ? 'Выйти из полноэкранного режима' : 'На весь экран'}
          icon={fullscreen() ? <Minimize /> : <Maximize />}
          pressed={fullscreen()}
          onClick={toggleFullscreen}
        />
      </div>
    </section>
  )
}
