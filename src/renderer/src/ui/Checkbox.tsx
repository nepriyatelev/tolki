import Check from 'lucide-solid/icons/check'
import { createUniqueId, Show, splitProps, type JSX } from 'solid-js'
import './Checkbox.css'

export interface CheckboxProps extends Omit<
  JSX.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'id'
> {
  label: string
  description?: string
  id?: string
}

/** A native checkbox (keyboard and screen readers work as usual) with a custom box. */
export function Checkbox(props: CheckboxProps): JSX.Element {
  const [own, rest] = splitProps(props, ['label', 'description', 'id', 'class'])
  const fallbackId = createUniqueId()
  const id = (): string => own.id ?? fallbackId
  const descriptionId = (): string => `${id()}-description`

  return (
    <div class="rt-checkbox" classList={{ [own.class ?? '']: !!own.class }}>
      <input
        id={id()}
        type="checkbox"
        class="rt-checkbox__input"
        aria-describedby={own.description !== undefined ? descriptionId() : undefined}
        {...rest}
      />
      <span class="rt-checkbox__box" aria-hidden="true">
        <Check strokeWidth={3} />
      </span>
      <span class="rt-checkbox__text">
        <label class="rt-checkbox__label" for={id()}>
          {own.label}
        </label>
        <Show when={own.description}>
          <span id={descriptionId()} class="rt-checkbox__description">
            {own.description}
          </span>
        </Show>
      </span>
    </div>
  )
}
