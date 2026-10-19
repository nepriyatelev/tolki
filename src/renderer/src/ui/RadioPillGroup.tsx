import { createUniqueId, For, Show, type JSX } from 'solid-js'
import './RadioPillGroup.css'

export interface RadioPillOption<T extends string> {
  value: T
  label: string
  description?: string
}

export interface RadioPillGroupProps<T extends string> {
  /** Group label, rendered as the fieldset legend. */
  legend: string
  options: readonly RadioPillOption<T>[]
  value: T
  onChange: (value: T) => void
  name?: string
  disabled?: boolean
  /**
   * One line: the legend beside small pills of labels only; the chosen option's description
   * under them (#110). Each description stays with its option for screen readers.
   */
  compact?: boolean
}

/**
 * Native radio buttons styled as selectable pills (screen mode picker in mockup 2).
 * Arrow keys move the selection, as with any radio group.
 */
export function RadioPillGroup<T extends string>(props: RadioPillGroupProps<T>): JSX.Element {
  const fallbackName = createUniqueId()
  const chosen = () => props.options.find((option) => option.value === props.value)

  return (
    <fieldset
      class="rt-radio-pills"
      classList={{ 'rt-radio-pills--compact': props.compact === true }}
      disabled={props.disabled}
    >
      <legend class="rt-radio-pills__legend">{props.legend}</legend>
      <div class="rt-radio-pills__options">
        <For each={props.options}>
          {(option) => (
            <label class="rt-radio-pill">
              <input
                type="radio"
                class="rt-radio-pill__input"
                name={props.name ?? fallbackName}
                value={option.value}
                checked={props.value === option.value}
                onChange={() => {
                  props.onChange(option.value)
                }}
              />
              <span class="rt-radio-pill__dot" aria-hidden="true" />
              <span class="rt-radio-pill__text">
                <span class="rt-radio-pill__label">{option.label}</span>
                <Show when={option.description}>
                  <span
                    class="rt-radio-pill__description"
                    classList={{ 'visually-hidden': props.compact === true }}
                  >
                    {option.description}
                  </span>
                </Show>
              </span>
            </label>
          )}
        </For>
      </div>
      <Show when={props.compact ? chosen()?.description : undefined}>
        {(description) => (
          <p class="rt-radio-pills__hint" aria-hidden="true">
            {description()}
          </p>
        )}
      </Show>
    </fieldset>
  )
}
