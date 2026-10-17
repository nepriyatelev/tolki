import ChevronDown from 'lucide-solid/icons/chevron-down'
import { createUniqueId, For, Show, splitProps, type JSX } from 'solid-js'
import './Field.css'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps extends Omit<
  JSX.SelectHTMLAttributes<HTMLSelectElement>,
  'id' | 'children'
> {
  label: string
  options: readonly SelectOption[]
  hint?: string
  id?: string
}

/** Native select (keyboard and screen readers as usual) styled like Input. */
export function Select(props: SelectProps): JSX.Element {
  const [own, rest] = splitProps(props, ['label', 'options', 'hint', 'id', 'class'])
  const fallbackId = createUniqueId()
  const id = (): string => own.id ?? fallbackId
  return (
    <div class="rt-field" classList={{ [own.class ?? '']: !!own.class }}>
      <label class="rt-field__label" for={id()}>
        {own.label}
      </label>
      <div class="rt-select">
        <select
          id={id()}
          class="rt-input rt-select__control"
          aria-describedby={own.hint !== undefined ? `${id()}-hint` : undefined}
          {...rest}
        >
          <For each={own.options}>
            {(option) => <option value={option.value}>{option.label}</option>}
          </For>
        </select>
        <ChevronDown class="rt-select__chevron" aria-hidden="true" />
      </div>
      <Show when={own.hint}>
        <p id={`${id()}-hint`} class="rt-field__message">
          {own.hint}
        </p>
      </Show>
    </div>
  )
}
