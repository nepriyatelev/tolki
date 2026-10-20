import { createEffect, createSignal, on, onCleanup, untrack, type Accessor } from 'solid-js'

/** How long things take to leave (#149): shorter than they take to come. */
export const EXIT_MS = 150

/**
 * Without matchMedia (tests) nothing animates, so there is nothing to wait for. With «reduce
 * motion» things still fade (the CSS drops the movement), so the wait stays.
 */
function exitMs(): number {
  return typeof window.matchMedia === 'function' ? EXIT_MS : 0
}

/**
 * Keeps something on screen while it leaves (#149): `mounted` stays true for EXIT_MS after
 * `when` turns false, and `closing` is true meanwhile, for the exit animation
 * (`data-closing`). Coming back during the exit cancels it.
 */
export function createPresence(when: Accessor<boolean>): {
  mounted: Accessor<boolean>
  closing: Accessor<boolean>
} {
  const [mounted, setMounted] = createSignal(untrack(when))
  const [closing, setClosing] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  createEffect(
    on(
      when,
      (open) => {
        clearTimeout(timer)
        if (open) {
          setClosing(false)
          setMounted(true)
          return
        }
        if (!untrack(mounted)) return
        const wait = exitMs()
        if (wait === 0) {
          setMounted(false)
          return
        }
        setClosing(true)
        timer = setTimeout(() => {
          setMounted(false)
          setClosing(false)
        }, wait)
      },
      { defer: true },
    ),
  )
  onCleanup(() => {
    clearTimeout(timer)
  })
  return { mounted, closing }
}
