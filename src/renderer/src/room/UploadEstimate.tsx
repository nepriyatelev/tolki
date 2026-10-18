import { createResource, Match, Switch, type JSX } from 'solid-js'
import { describeUpload } from './upload-estimate'

/**
 * Upload estimate for the "create room" screen (issue #16 places it in "Проверка сети").
 * Renders nothing when the speed test is off or failed.
 */
export function UploadEstimate(props: { class?: string }): JSX.Element {
  const [measurement] = createResource(() => window.ratatosk.network.measureUpload())
  const text = () => {
    const value = measurement.latest
    return value ? describeUpload(value) : null
  }

  return (
    <Switch>
      <Match when={measurement.loading}>
        <p class={props.class}>Замер отдачи…</p>
      </Match>
      <Match when={text()}>{(line) => <p class={props.class}>{line()}</p>}</Match>
    </Switch>
  )
}
