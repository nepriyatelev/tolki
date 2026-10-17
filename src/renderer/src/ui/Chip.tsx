import { Show, splitProps, type JSX } from 'solid-js'
import './Chip.css'

export type ChipTone = 'neutral' | 'accent' | 'danger' | 'overlay'

export interface ChipProps extends JSX.HTMLAttributes<HTMLSpanElement> {
  tone?: ChipTone
  /** Status dot before the text (e.g. "Идёт · 2 человека"). */
  dot?: boolean
  icon?: JSX.Element
  mono?: boolean
  size?: 'sm' | 'md'
}

/** Non-interactive label: statuses, timers, ping, badges like "хост". */
export function Chip(props: ChipProps): JSX.Element {
  const [own, rest] = splitProps(props, [
    'tone',
    'dot',
    'icon',
    'mono',
    'size',
    'class',
    'children',
  ])
  return (
    <span
      class={`rt-chip rt-chip--${own.tone ?? 'neutral'} rt-chip--${own.size ?? 'md'}`}
      classList={{ 'rt-chip--mono': own.mono === true, [own.class ?? '']: !!own.class }}
      {...rest}
    >
      <Show when={own.dot}>
        <span class="rt-chip__dot" aria-hidden="true" />
      </Show>
      <Show when={own.icon}>{own.icon}</Show>
      {own.children}
    </span>
  )
}
