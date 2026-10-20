import { render } from '@solidjs/testing-library'
import { describe, expect, it } from 'vitest'
import {
  bezelFor,
  DEFAULT_LIGHT,
  displacementMap,
  glassHeight,
  glassShape,
  liquidGlass,
  refraction,
  specularMap,
} from './liquid-glass'

const W = 200
const H = 80
const shape = glassShape(W, H, 40, 24)
const px = (map: Uint8ClampedArray, x: number, y: number) => {
  const i = (y * W + x) * 4
  return { r: map[i] ?? 0, g: map[i + 1] ?? 0, a: map[i + 3] ?? 0 }
}

describe('the glass profile (#149)', () => {
  it('rises from the edge to the flat middle, steepest at the edge', () => {
    expect(glassHeight(0)).toBe(0)
    expect(glassHeight(1)).toBe(1)
    expect(glassHeight(0.1) - glassHeight(0)).toBeGreaterThan(glassHeight(1) - glassHeight(0.9))
  })

  it('bends light most near the edge and not at all in the middle', () => {
    const { magnitudes, max } = refraction()
    expect(max).toBeGreaterThan(0)
    expect(Math.max(...magnitudes)).toBeCloseTo(1)
    expect(magnitudes.at(-1) ?? 1).toBeLessThan(0.05)
  })
})

describe('displacementMap', () => {
  const map = displacementMap(shape)

  it('leaves the middle in place and samples from further in at the rim', () => {
    expect(px(map, 100, 40)).toMatchObject({ r: 128, g: 128 })
    // Left edge: the backdrop comes from the right (inward); right edge, from the left.
    expect(px(map, 2, 40).r).toBeGreaterThan(128)
    expect(px(map, 197, 40).r).toBeLessThan(128)
    // Top: from below; bottom: from above.
    expect(px(map, 100, 3).g).toBeGreaterThan(128)
    expect(px(map, 100, 76).g).toBeLessThan(128)
  })

  it('outside the rounded corner nothing moves', () => {
    expect(px(map, 0, 0)).toMatchObject({ r: 128, g: 128 })
  })
})

describe('specularMap', () => {
  const map = specularMap(shape, DEFAULT_LIGHT, 1)

  it('lights a thin line on the rim facing the light, less on the other side, none inside', () => {
    const lit = px(map, 100, 0).a
    const opposite = px(map, 100, 79).a
    expect(lit).toBeGreaterThan(opposite)
    expect(opposite).toBeGreaterThan(0)
    expect(px(map, 100, 40).a).toBe(0)
    // The line is thin: a few pixels in it has faded.
    expect(px(map, 100, 6).a).toBeLessThan(lit / 3)
  })

  it('follows the light round the rim', () => {
    const fromBelow = specularMap(shape, Math.PI / 2, 1)
    expect(px(fromBelow, 100, 79).a).toBeGreaterThan(px(fromBelow, 100, 0).a)
  })

  it('a press energises it', () => {
    expect(px(specularMap(shape, DEFAULT_LIGHT, 1, 1.8), 100, 3).a).toBeGreaterThan(
      px(map, 100, 3).a,
    )
  })
})

describe('bezelFor', () => {
  it('stays within the corner and a third of the height, at most 26', () => {
    expect(bezelFor(80, 40)).toBe(25.6)
    expect(bezelFor(200, 999)).toBe(26)
    expect(bezelFor(32, 6)).toBe(6)
  })
})

describe('liquidGlass', () => {
  it('adds its own filter and removes it with the component', () => {
    const view = render(() => <div ref={liquidGlass} class="rt-glass rt-glass--liquid" />)
    expect(document.querySelectorAll('svg filter[id^="glass-lens-"]')).toHaveLength(1)
    view.unmount()
    expect(document.querySelectorAll('svg filter[id^="glass-lens-"]')).toHaveLength(0)
  })

  it('a press on a control lights it from under the pointer', () => {
    const { container } = render(() => (
      <div ref={liquidGlass}>
        <span class="rt-glass-control" />
      </div>
    ))
    const control = container.querySelector<HTMLElement>('.rt-glass-control')
    if (!control) throw new Error('no control')
    control.getBoundingClientRect = () => ({ left: 10, top: 20, width: 46, height: 46 }) as DOMRect
    control.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 30, clientY: 50 }),
    )
    expect(control.hasAttribute('data-pressed')).toBe(true)
    expect(control.style.getPropertyValue('--press-x')).toBe('20px')
    expect(control.style.getPropertyValue('--press-y')).toBe('30px')
  })
})
