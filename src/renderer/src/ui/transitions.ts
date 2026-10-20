/** Things move on screen at this pace (#149): long enough to follow, short enough not to wait. */
const LAYOUT_MS = 240
const EASE_OUT = 'cubic-bezier(0.2, 0, 0, 1)'

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * One screen or view becomes another as a whole (#149): the View Transitions API cross-fades
 * them, and what has the same `view-transition-name` on both sides (the room's name, the button
 * that becomes the call's bar, a person's tile and their place in the strip) moves from one to
 * the other. The update runs a frame later, after the old view is captured; without the API
 * (tests) it runs at once. Only for what the user did — not for room events, which must apply
 * at once.
 */
export function viewTransition(update: () => void): void {
  if (typeof document.startViewTransition !== 'function') {
    update()
    return
  }
  document.startViewTransition(update)
}

/**
 * The elements marked `data-flip` inside `container` glide from where they were to where the
 * update puts them, and new ones come in (FLIP, #149). The update itself runs at once, so the
 * state stays in step with room events; only the picture catches up. With «reduce motion»
 * things only fade in.
 */
export function animateLayout(container: HTMLElement | undefined, update: () => void): void {
  if (!container || typeof container.animate !== 'function') {
    update()
    return
  }
  const before = new Map<string, DOMRect>()
  for (const element of container.querySelectorAll<HTMLElement>('[data-flip]')) {
    before.set(element.dataset['flip'] ?? '', element.getBoundingClientRect())
  }
  update()
  const still = reducedMotion()
  for (const element of container.querySelectorAll<HTMLElement>('[data-flip]')) {
    const was = before.get(element.dataset['flip'] ?? '')
    const now = element.getBoundingClientRect()
    if (!was) {
      element.animate(
        still
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { opacity: 0, transform: 'scale(0.96)' },
              { opacity: 1, transform: 'none' },
            ],
        { duration: LAYOUT_MS, easing: EASE_OUT },
      )
      continue
    }
    if (still || now.width === 0 || now.height === 0) continue
    const dx = was.left - now.left
    const dy = was.top - now.top
    const sx = was.width / now.width
    const sy = was.height / now.height
    if (
      Math.abs(dx) < 1 &&
      Math.abs(dy) < 1 &&
      Math.abs(sx - 1) < 0.01 &&
      Math.abs(sy - 1) < 0.01
    ) {
      continue
    }
    element.animate(
      [
        { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
        { transformOrigin: '0 0', transform: 'none' },
      ],
      { duration: LAYOUT_MS, easing: EASE_OUT },
    )
  }
}
