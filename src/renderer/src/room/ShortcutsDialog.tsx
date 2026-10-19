import X from 'lucide-solid/icons/x'
import { createEffect, For, Show, type JSX } from 'solid-js'
import { acceleratorLabel } from '@shared/global-hotkeys'
import { pushToTalkKeyLabel } from '@shared/push-to-talk'
import { IconButton } from '../ui'
import { callKeyLabel } from './call-keys'
import './ShortcutsDialog.css'

/**
 * Every key of the call in one place (#110), by Ctrl+/ (⌘/ on macOS), as in Discord and Meet —
 * instead of a line at the bottom of the call that was always there.
 */
export function ShortcutsDialog(props: {
  open: boolean
  onClose: () => void
  mac: boolean
  /** The push-to-talk key when push-to-talk is on (PLAN #39). */
  pushToTalkKey: string | null
  /** «Клавиши в любом окне» (PLAN #40); empty when not set. */
  globalHotkeys: { mute: string; deafen: string }
}): JSX.Element {
  let dialog: HTMLDialogElement | undefined
  createEffect(() => {
    if (!dialog) return
    if (props.open && !dialog.open) dialog.showModal()
    if (!props.open && dialog.open) dialog.close()
  })
  const rows = (): { what: string; keys: string }[] => [
    ...(props.pushToTalkKey
      ? [{ what: 'Говорить, пока нажата', keys: pushToTalkKeyLabel(props.pushToTalkKey) }]
      : [{ what: 'Микрофон', keys: callKeyLabel('mic', props.mac) }]),
    { what: 'Звук', keys: callKeyLabel('sound', props.mac) },
    ...(props.globalHotkeys.mute
      ? [{ what: 'Микрофон в любом окне', keys: acceleratorLabel(props.globalHotkeys.mute) }]
      : []),
    ...(props.globalHotkeys.deafen
      ? [{ what: 'Звук в любом окне', keys: acceleratorLabel(props.globalHotkeys.deafen) }]
      : []),
    { what: 'Список клавиш', keys: callKeyLabel('shortcuts', props.mac) },
    { what: 'Закрыть окно или выйти из полноэкранного режима', keys: 'Esc' },
  ]
  return (
    <dialog
      ref={(element) => {
        dialog = element
      }}
      class="shortcuts"
      aria-labelledby="shortcuts-title"
      onClose={() => {
        props.onClose()
      }}
    >
      <Show when={props.open}>
        <header class="shortcuts-header">
          <h2 id="shortcuts-title">Клавиши</h2>
          <IconButton
            label="Закрыть"
            icon={<X />}
            variant="ghost"
            onClick={() => {
              props.onClose()
            }}
          />
        </header>
        <dl class="shortcuts-list">
          <For each={rows()}>
            {(row) => (
              <div class="shortcuts-row">
                <dt>{row.what}</dt>
                <dd>
                  <kbd>{row.keys}</kbd>
                </dd>
              </div>
            )}
          </For>
        </dl>
        <p class="shortcuts-note">
          «Клавиши в любом окне» и «Говорить по клавише» — в «Настройках».
        </p>
      </Show>
    </dialog>
  )
}
