import TriangleAlert from 'lucide-solid/icons/triangle-alert'
import { createResource, For, Match, Show, Switch, type JSX, type Resource } from 'solid-js'
import type { NetworkCheckResult } from '@shared/network'
import { describeHosting, type HostingStatusText } from './hosting-status'
import './NetworkStatusBar.css'

/** One network check for the home screen, shared by the footer and the notice above the cards. */
export interface NetworkCheck {
  result: Resource<NetworkCheckResult>
  /** «Проверить снова»: always a fresh check. */
  retry: () => void
}

export function createNetworkCheck(): NetworkCheck {
  // The first check may come from main's cache; "Проверить снова" always re-checks.
  let force = false
  const [result, { refetch }] = createResource(() => window.tolki.network.check({ force }))
  return {
    result,
    retry: () => {
      force = true
      void refetch()
    },
  }
}

function hostingText(check: NetworkCheck): HostingStatusText | undefined {
  const value = check.result.latest
  return value ? describeHosting(value) : undefined
}

/**
 * Home screen footer: can this computer host a room? (mockup 1, PLAN #9) With `problemsAbove`,
 * a verdict that it cannot is left to {@link NetworkNotice} over the cards (#110).
 */
export function NetworkStatusBar(props: {
  check?: NetworkCheck
  problemsAbove?: boolean
}): JSX.Element {
  // eslint-disable-next-line solid/reactivity -- one check for the screen's life
  const check = props.check ?? createNetworkCheck()
  const text = () => hostingText(check)

  return (
    <footer class="network-status" aria-live="polite">
      <Switch>
        <Match when={check.result.loading}>
          <span class="network-status__item">
            <span class="network-status__dot network-status__dot--pending" aria-hidden="true" />
            Проверка сети…
          </span>
        </Match>
        <Match when={check.result.error !== undefined}>
          <span class="network-status__item">
            <span class="network-status__dot network-status__dot--bad" aria-hidden="true" />
            Не удалось проверить сеть
          </span>
          <RetryButton onClick={check.retry} />
        </Match>
        <Match when={props.problemsAbove === true && text()?.tone === 'bad'}>{null}</Match>
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
              <RetryButton onClick={check.retry} />
            </>
          )}
        </Match>
      </Switch>
    </footer>
  )
}

/**
 * The verdict that this computer cannot host, over the cards: it decides whether «Создать
 * комнату» works at all, so it is not a footnote (#110). A warning, not an error: joining by a
 * link still works, and the advice says what helps.
 */
export function NetworkNotice(props: { check: NetworkCheck }): JSX.Element {
  const problem = () => {
    const text = hostingText(props.check)
    return !props.check.result.loading && text?.tone === 'bad' ? text : undefined
  }
  return (
    <Show when={problem()}>
      {(status) => (
        <section class="network-notice" role="status" aria-label="Состояние сети">
          <TriangleAlert class="network-notice__icon" aria-hidden="true" />
          <div class="network-notice__text">
            <strong>{status().title}</strong>
            <For each={status().details}>{(detail) => <span>{detail}</span>}</For>
          </div>
          <RetryButton onClick={props.check.retry} />
        </section>
      )}
    </Show>
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
