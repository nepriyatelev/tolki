import { splitProps, type JSX } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import './Card.css'

export interface CardProps extends JSX.HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'article'
  padding?: 'none' | 'md' | 'lg'
  /** Darker inset panel (e.g. microphone check inside a card). */
  inset?: boolean
}

export function Card(props: CardProps): JSX.Element {
  const [own, rest] = splitProps(props, ['as', 'padding', 'inset', 'class'])
  return (
    <Dynamic
      component={own.as ?? 'div'}
      class={`rt-card rt-card--pad-${own.padding ?? 'lg'}`}
      classList={{ 'rt-card--inset': own.inset === true, [own.class ?? '']: !!own.class }}
      {...rest}
    />
  )
}
