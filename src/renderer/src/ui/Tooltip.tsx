import { createSignal, createUniqueId, onCleanup, Show, type JSX } from 'solid-js'
import './Tooltip.css'

/** Hover waits this long, as in other apps: a tooltip should not flash past the pointer. */
export const TOOLTIP_DELAY_MS = 500
/** Right after one tooltip, the next comes at once: moving along the bar should not wait. */
const WARM_MS = 800
let lastHidden = 0

export interface TooltipProps {
  /** What the control does, and its key if it has one: «Выключить микрофон · Ctrl+Shift+M». */
  text: string
  /** Above the control by default; the call's controls sit at the bottom, so above suits them. */
  placement?: 'top' | 'bottom'
  /** The control; it gets the tooltip's id for aria-describedby. */
  children: (describedBy: string) => JSX.Element
}

/**
 * A tooltip on liquid glass (#110): after a short hover, at once on keyboard focus, gone on
 * leave, blur or Esc. The control keeps its own accessible name; the tooltip describes it.
 */
export function Tooltip(props: TooltipProps): JSX.Element {
  const id = createUniqueId()
  const [shown, setShown] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  const show = (delay: number): void => {
    clearTimeout(timer)
    const warm = Date.now() - lastHidden < WARM_MS
    timer = setTimeout(() => setShown(true), warm ? 0 : delay)
  }
  const hide = (): void => {
    clearTimeout(timer)
    if (shown()) lastHidden = Date.now()
    setShown(false)
  }
  onCleanup(() => {
    clearTimeout(timer)
  })
  return (
    <span
      class="rt-tooltip-anchor"
      onMouseEnter={() => {
        show(TOOLTIP_DELAY_MS)
      }}
      onMouseLeave={hide}
      onFocusIn={(event) => {
        // Keyboard focus only: a click also focuses, and then the tooltip would cover the result.
        if (focusVisible(event.target)) show(0)
      }}
      onFocusOut={hide}
      onKeyDown={(event) => {
        if (event.key === 'Escape') hide()
      }}
      onPointerDown={hide}
    >
      {props.children(id)}
      <Show when={shown()}>
        <span
          id={id}
          role="tooltip"
          class={`rt-tooltip rt-glass rt-glass--sm rt-tooltip--${props.placement ?? 'top'}`}
        >
          {props.text}
        </span>
      </Show>
    </span>
  )
}

function focusVisible(target: EventTarget | null): boolean {
  try {
    return target instanceof HTMLElement && target.matches(':focus-visible')
  } catch {
    // An engine without :focus-visible: treat focus as keyboard focus.
    return true
  }
}
