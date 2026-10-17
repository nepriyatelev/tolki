import { createUniqueId, Show, splitProps, type JSX } from 'solid-js'
import './Field.css'

export interface InputProps extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'id'> {
  /** Visible label; always required so the field has an accessible name. */
  label: string
  hint?: string
  /** Shown instead of the hint and marks the field invalid. */
  error?: string | undefined
  /** Monospace text, for links, passwords, ports. */
  mono?: boolean
  id?: string
}

export function Input(props: InputProps): JSX.Element {
  const [own, rest] = splitProps(props, ['label', 'hint', 'error', 'mono', 'id', 'class'])
  const fallbackId = createUniqueId()
  const id = (): string => own.id ?? fallbackId
  const messageId = (): string => `${id()}-message`
  const message = (): string | undefined => own.error ?? own.hint

  return (
    <div class="rt-field" classList={{ [own.class ?? '']: !!own.class }}>
      <label class="rt-field__label" for={id()}>
        {own.label}
      </label>
      <input
        id={id()}
        class="rt-input"
        classList={{ 'rt-input--mono': own.mono === true }}
        aria-invalid={own.error !== undefined ? true : undefined}
        aria-describedby={message() !== undefined ? messageId() : undefined}
        {...rest}
      />
      <Show when={message()}>
        {(text) => (
          <p
            id={messageId()}
            class="rt-field__message"
            classList={{ 'rt-field__message--error': own.error !== undefined }}
          >
            {text()}
          </p>
        )}
      </Show>
    </div>
  )
}
