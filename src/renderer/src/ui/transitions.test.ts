import { afterEach, describe, expect, it, vi } from 'vitest'
import { animateLayout, viewTransition } from './transitions'

describe('viewTransition (#149)', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'startViewTransition')
  })

  it('without the API the update runs at once', () => {
    const update = vi.fn()
    viewTransition(update)
    expect(update).toHaveBeenCalledOnce()
  })

  it('with it, the update goes to the transition', () => {
    const start = vi.fn((callback: () => void) => {
      callback()
    })
    Object.assign(document, { startViewTransition: start })
    const update = vi.fn()
    viewTransition(update)
    expect(start).toHaveBeenCalledWith(update)
    expect(update).toHaveBeenCalledOnce()
  })
})

describe('animateLayout', () => {
  function tile(id: string, left: number, container: HTMLElement) {
    const element = document.createElement('li')
    element.dataset['flip'] = id
    element.getBoundingClientRect = () => ({ left, top: 0, width: 100, height: 60 }) as DOMRect
    const animate = vi.fn()
    Object.assign(element, { animate })
    container.append(element)
    return { element, animate }
  }
  function list(): HTMLUListElement {
    const element = document.createElement('ul')
    Object.assign(element, { animate: vi.fn() })
    return element
  }

  it('runs the update at once, slides the ones that moved and fades in the new ones', () => {
    const grid = list()
    const moved = tile('a', 0, grid)
    let added: ReturnType<typeof tile> | undefined
    animateLayout(grid, () => {
      moved.element.getBoundingClientRect = () =>
        ({ left: 120, top: 0, width: 100, height: 60 }) as DOMRect
      added = tile('b', 0, grid)
    })
    expect(moved.animate).toHaveBeenCalledWith(
      [
        expect.objectContaining({ transform: 'translate(-120px, 0px) scale(1, 1)' }),
        expect.objectContaining({ transform: 'none' }),
      ],
      expect.anything(),
    )
    expect(added?.animate).toHaveBeenCalledWith(
      [expect.objectContaining({ opacity: 0 }), expect.objectContaining({ opacity: 1 })],
      expect.anything(),
    )
  })

  it('leaves the ones that stayed in place alone', () => {
    const grid = list()
    const still = tile('a', 10, grid)
    animateLayout(grid, () => undefined)
    expect(still.animate).not.toHaveBeenCalled()
  })

  it('without a container or the animations API it just updates', () => {
    const update = vi.fn()
    animateLayout(undefined, update)
    expect(update).toHaveBeenCalledOnce()
  })
})
