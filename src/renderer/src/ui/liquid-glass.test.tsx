import { render } from '@solidjs/testing-library'
import { describe, expect, it } from 'vitest'
import { lensFor, lensMap, liquidGlass } from './liquid-glass'

const at = (map: Uint8ClampedArray, width: number, x: number, y: number) => {
  const i = (y * width + x) * 4
  return { r: map[i], g: map[i + 1] }
}

describe('lensMap (#149)', () => {
  it('leaves the middle in place and pulls the backdrop inward at the rim', () => {
    const map = lensMap(200, 80, 40, 20)
    expect(at(map, 200, 100, 40)).toEqual({ r: 128, g: 128 })
    // Near the left edge the backdrop comes from further left (outward normal: −x).
    expect(at(map, 200, 1, 40).r).toBeLessThan(128)
    // Near the right edge, from the right.
    expect(at(map, 200, 198, 40).r).toBeGreaterThan(128)
    // Near the top, from above; near the bottom, from below.
    expect(at(map, 200, 100, 1).g).toBeLessThan(128)
    expect(at(map, 200, 100, 78).g).toBeGreaterThan(128)
  })

  it('is stronger the closer to the edge', () => {
    const map = lensMap(200, 80, 40, 20)
    const edge = 128 - (at(map, 200, 100, 1).g ?? 128)
    const inner = 128 - (at(map, 200, 100, 15).g ?? 128)
    expect(edge).toBeGreaterThan(inner)
    expect(inner).toBeGreaterThan(0)
  })

  it('outside the rounded corner nothing moves', () => {
    expect(at(lensMap(200, 80, 40, 20), 200, 0, 0)).toEqual({ r: 128, g: 128 })
  })
})

describe('lensFor', () => {
  it('scales the lens with the surface, within bounds', () => {
    expect(lensFor(80)).toEqual({ bezel: 22, scale: 40 })
    expect(lensFor(32)).toEqual({ bezel: 9.6, scale: 16 })
    expect(lensFor(400)).toEqual({ bezel: 22, scale: 42 })
  })
})

describe('liquidGlass', () => {
  it('adds its own lens filter and removes it with the component', () => {
    const view = render(() => <div ref={liquidGlass} class="rt-glass rt-glass--liquid" />)
    expect(document.querySelectorAll('svg filter[id^="glass-lens-"]')).toHaveLength(1)
    view.unmount()
    expect(document.querySelectorAll('svg filter[id^="glass-lens-"]')).toHaveLength(0)
  })

  it('moves the highlight to the pointer', () => {
    const { container } = render(() => <div ref={liquidGlass} />)
    const element = container.firstElementChild as HTMLElement
    element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect
    element.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 25 }))
    expect(element.style.getPropertyValue('--glass-lx')).toBe('25%')
    expect(element.style.getPropertyValue('--glass-ly')).toBe('25%')
  })
})
