import { createSignal, onCleanup, type JSX } from 'solid-js'
import { Button } from '../ui'

/** «Попробовать снова», optionally locked for a while (the host blocks guesses for a minute). */
export function RetryButton(props: { waitSeconds: number; onRetry: () => void }): JSX.Element {
  // eslint-disable-next-line solid/reactivity -- the countdown starts from the initial value
  const [left, setLeft] = createSignal(props.waitSeconds)
  const timer = setInterval(() => {
    setLeft((s) => {
      if (s <= 1) clearInterval(timer)
      return Math.max(0, s - 1)
    })
  }, 1000)
  onCleanup(() => {
    clearInterval(timer)
  })

  return (
    <Button
      variant="primary"
      disabled={left() > 0}
      onClick={() => {
        props.onRetry()
      }}
    >
      {left() > 0 ? `Попробовать снова через ${left()} с` : 'Попробовать снова'}
    </Button>
  )
}
