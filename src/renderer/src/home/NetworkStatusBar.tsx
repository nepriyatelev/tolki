import { createResource, For, Match, Switch, type JSX } from 'solid-js'
import { describeHosting } from './hosting-status'
import './NetworkStatusBar.css'

/** Home screen footer: can this computer host a room? (mockup 1, PLAN #9) */
export function NetworkStatusBar(): JSX.Element {
  // The first check may come from main's cache; "Проверить снова" always re-checks.
  let force = false
  const [result, { refetch }] = createResource(() => window.ratatosk.network.check({ force }))
  const text = () => {
    const value = result.latest
    return value ? describeHosting(value) : undefined
  }

  const retry = (): void => {
    force = true
    void refetch()
  }

  return (
    <footer class="network-status" aria-live="polite">
      <Switch>
        <Match when={result.loading}>
          <span class="network-status__item">
            <span class="network-status__dot network-status__dot--pending" aria-hidden="true" />
            Проверяем сеть…
          </span>
        </Match>
        <Match when={result.error !== undefined}>
          <span class="network-status__item">
            <span class="network-status__dot network-status__dot--bad" aria-hidden="true" />
            Не удалось проверить сеть
          </span>
          <RetryButton onClick={retry} />
        </Match>
        <Match when={text()}>
          {(status) => (
            <>
              <span class="network-status__item">
                <span
                  class={`network-status__dot network-status__dot--${status().tone}`}
                  aria-hidden="true"
                />
                {status().title}
              </span>
              <For each={status().details}>
                {(detail) => <span class="network-status__item">{detail}</span>}
              </For>
              <RetryButton onClick={retry} />
            </>
          )}
        </Match>
      </Switch>
    </footer>
  )
}

function RetryButton(props: { onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      class="network-status__retry"
      onClick={() => {
        props.onClick()
      }}
    >
      Проверить снова
    </button>
  )
}
