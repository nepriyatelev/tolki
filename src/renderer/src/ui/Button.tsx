import { Show, splitProps, type JSX } from 'solid-js'
import './Button.css'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'md' | 'lg'
  /** Stretch to the container width. */
  block?: boolean
  /** Lucide icon before / after the label; icons are decorative. */
  icon?: JSX.Element
  iconEnd?: JSX.Element
}

export function Button(props: ButtonProps): JSX.Element {
  const [own, rest] = splitProps(props, [
    'variant',
    'size',
    'block',
    'icon',
    'iconEnd',
    'class',
    'type',
    'children',
  ])
  return (
    <button
      type={own.type ?? 'button'}
      class={`rt-button rt-button--${own.variant ?? 'secondary'} rt-button--${own.size ?? 'md'}`}
      classList={{ 'rt-button--block': own.block === true, [own.class ?? '']: !!own.class }}
      {...rest}
    >
      <Show when={own.icon}>{own.icon}</Show>
      <span>{own.children}</span>
      <Show when={own.iconEnd}>{own.iconEnd}</Show>
    </button>
  )
}

export type IconButtonVariant = 'secondary' | 'ghost' | 'accent' | 'danger'

export interface IconButtonProps extends Omit<
  JSX.ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'aria-label'
> {
  /** Accessible name; also shown as the native tooltip. */
  label: string
  icon: JSX.Element
  variant?: IconButtonVariant
  shape?: 'square' | 'round'
  /** md = 44px (toolbar), lg = 60px (call controls). */
  size?: 'md' | 'lg'
  /** For toggles such as mute: exposed as aria-pressed. */
  pressed?: boolean
}

export function IconButton(props: IconButtonProps): JSX.Element {
  const [own, rest] = splitProps(props, [
    'label',
    'icon',
    'variant',
    'shape',
    'size',
    'pressed',
    'class',
    'type',
    'title',
  ])
  return (
    <button
      type={own.type ?? 'button'}
      class={`rt-icon-button rt-icon-button--${own.variant ?? 'secondary'} rt-icon-button--${own.shape ?? 'square'} rt-icon-button--${own.size ?? 'md'}`}
      classList={{ [own.class ?? '']: !!own.class }}
      aria-label={own.label}
      title={own.title ?? own.label}
      aria-pressed={own.pressed}
      {...rest}
    >
      {own.icon}
    </button>
  )
}
