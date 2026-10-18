import { describe, expect, it } from 'vitest'
import css from './tokens.css?raw'

const tokens = new Map(
  [...css.matchAll(/--(color-[\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2]]),
)

function color(name: string): string {
  const value = tokens.get(name)
  if (value === undefined) throw new Error(`token --${name} is missing or not a #rrggbb color`)
  return value
}

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

// Every text colour is listed with every surface it is used on.
const textPairs: [fg: string, bg: string][] = [
  ...['bg', 'surface', 'panel', 'chip', 'raised', 'sunken'].flatMap((bg) => [
    ['color-text', `color-${bg}`] as [string, string],
    ['color-text-soft', `color-${bg}`] as [string, string],
    ['color-text-muted', `color-${bg}`] as [string, string],
  ]),
  ['color-text-placeholder', 'color-bg'],
  ['color-text-placeholder', 'color-surface'],
  ['color-on-accent', 'color-accent'],
  ['color-on-accent', 'color-accent-hover'],
  ['color-accent-text', 'color-bg'],
  ['color-accent-text', 'color-surface'],
  ['color-accent-text', 'color-accent-soft'],
  ['color-accent-soft-text', 'color-accent-soft'],
  ['color-text', 'color-accent-selected'],
  ['color-on-danger', 'color-danger'],
  ['color-on-danger', 'color-danger-hover'],
  ['color-danger-text', 'color-surface'],
  ['color-danger-text', 'color-danger-soft'],
  ['color-danger-text', 'color-chip'],
  ['color-warning-text', 'color-warning-soft'],
  ['color-warning-text', 'color-surface'],
  ...[1, 2, 3, 4, 5, 6].map((i) => ['#ffffff', `color-avatar-${i}`] as [string, string]),
]

describe('design tokens', () => {
  it.each(textPairs)('%s on %s has text contrast of at least 4.5:1', (fg, bg) => {
    const ratio = contrast(fg.startsWith('#') ? fg : color(fg), color(bg))
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  // --color-focus is var(--color-accent); WCAG 1.4.11 asks for 3:1 against adjacent colours.
  it('focus ring is an alias of the accent text colour', () => {
    expect(css).toMatch(/--color-focus:\s*var\(--color-accent-text\)/)
  })

  it.each(['color-bg', 'color-surface', 'color-panel', 'color-raised'])(
    'focus ring is visible (3:1) on %s',
    (bg) => {
      expect(contrast(color('color-accent-text'), color(bg))).toBeGreaterThanOrEqual(3)
    },
  )
})
