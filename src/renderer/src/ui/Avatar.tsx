import { type JSX } from 'solid-js'
import './Avatar.css'

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

export interface AvatarProps {
  name: string
  size?: AvatarSize
  /** Mint ring around the active speaker. */
  speaking?: boolean
  /** Rounded square for rooms, circle for people. */
  shape?: 'round' | 'square'
  /**
   * Avatars usually sit next to the visible name and are hidden from assistive tech.
   * Set to false when the avatar is shown alone; the name becomes its label.
   */
  decorative?: boolean
}

const PALETTE_SIZE = 6

export function avatarInitial(name: string): string {
  const first = Array.from(name.trim())[0]
  return first === undefined ? '?' : first.toLocaleUpperCase('ru')
}

/** Stable colour index for a name, so a participant keeps their colour everywhere. */
export function avatarColorIndex(name: string): number {
  let hash = 0
  for (const char of name.trim().toLocaleLowerCase('ru')) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  }
  return (hash % PALETTE_SIZE) + 1
}

export function Avatar(props: AvatarProps): JSX.Element {
  const decorative = (): boolean => props.decorative !== false
  return (
    <span
      class={`rt-avatar rt-avatar--${props.size ?? 'md'} rt-avatar--color-${avatarColorIndex(props.name)}`}
      classList={{
        'rt-avatar--speaking': props.speaking === true,
        'rt-avatar--square': props.shape === 'square',
      }}
      role={decorative() ? undefined : 'img'}
      aria-label={decorative() ? undefined : props.name}
      aria-hidden={decorative() ? 'true' : undefined}
    >
      {avatarInitial(props.name)}
    </span>
  )
}
