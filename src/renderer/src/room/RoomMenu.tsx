import Ellipsis from 'lucide-solid/icons/ellipsis'
import { createSignal, createUniqueId, onCleanup, onMount, Show, type JSX } from 'solid-js'
import { Checkbox, createPresence, IconButton, liquidGlass } from '../ui'
import './RoomMenu.css'

/**
 * The organizer's «⋯» next to «Пригласить» (#110): entry by approval with words instead of a
 * bare lock icon, and the organizer's upload. A glass popover anchored to its button.
 */
export function RoomMenu(props: {
  approval: boolean
  onApprovalChange: () => void
  /** «Отдача организатора 39 Мбит/с — …», once the host knows it. */
  upload: string | undefined
}): JSX.Element {
  const [open, setOpen] = createSignal(false)
  const presence = createPresence(open)
  const id = createUniqueId()
  let root: HTMLDivElement | undefined
  onMount(() => {
    const close = (event: Event): void => {
      if (!open()) return
      if (
        event instanceof KeyboardEvent
          ? event.key === 'Escape'
          : !root?.contains(event.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    onCleanup(() => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    })
  })
  return (
    <div
      class="room-menu"
      ref={(element) => {
        root = element
      }}
    >
      <IconButton
        label="Меню комнаты"
        icon={<Ellipsis />}
        aria-haspopup="dialog"
        aria-expanded={open()}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      />
      <Show when={presence.mounted()}>
        <div
          ref={liquidGlass}
          id={id}
          data-closing={presence.closing() || undefined}
          class="room-menu-panel rt-glass rt-glass--liquid"
          role="dialog"
          aria-label="Комната"
        >
          <Checkbox
            label="Подтверждать вход"
            description="Вошедший по ссылке ждёт, пока организатор нажмёт «Впустить»."
            checked={props.approval}
            onChange={() => {
              props.onApprovalChange()
            }}
          />
          <Show when={props.upload}>{(upload) => <p class="room-menu-upload">{upload()}</p>}</Show>
        </div>
      </Show>
    </div>
  )
}
