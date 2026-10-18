import Monitor from 'lucide-solid/icons/monitor'
import RefreshCw from 'lucide-solid/icons/refresh-cw'
import X from 'lucide-solid/icons/x'
import {
  createEffect,
  createResource,
  createSignal,
  For,
  Match,
  Show,
  Switch,
  type JSX,
} from 'solid-js'
import type { CaptureSource } from '@shared/screen'
import { Button, IconButton } from '../ui'
import { browserScreen, type ScreenAccess } from './screen-share'
import './ScreenSourceDialog.css'

type Tab = 'screen' | 'window'

/**
 * «Что показать» (PLAN #26, drawn in code): screens and windows with live previews. On Wayland the
 * system portal asks instead; on macOS without «Запись экрана» it explains how to allow it.
 */
export function ScreenSourceDialog(props: {
  open: boolean
  onClose: () => void
  /** null: the system picker (Wayland) chooses. */
  onPick: (sourceId: string | null) => void
  access?: ScreenAccess
}): JSX.Element {
  let dialog: HTMLDialogElement | undefined
  const access = (): ScreenAccess => props.access ?? browserScreen
  const [tab, setTab] = createSignal<Tab>('screen')
  const [selected, setSelected] = createSignal<string | null>(null)
  // Fresh previews every time the dialog opens.
  const [sources, { refetch }] = createResource(
    () => props.open || undefined,
    () => access().listSources(),
  )

  createEffect(() => {
    if (!dialog) return
    if (props.open && !dialog.open) {
      setSelected(null)
      setTab('screen')
      dialog.showModal()
    }
    if (!props.open && dialog.open) dialog.close()
  })

  const listed = (): CaptureSource[] => {
    const result = sources.latest
    return result?.picker === 'app' ? result.sources : []
  }
  const shown = (): CaptureSource[] => listed().filter((source) => source.kind === tab())
  const count = (kind: Tab): number => listed().filter((source) => source.kind === kind).length

  const pick = (): void => {
    const id = selected()
    if (id !== null) props.onPick(id)
  }

  return (
    <dialog
      ref={(element) => {
        dialog = element
      }}
      class="screen-picker"
      aria-labelledby="screen-picker-title"
      onClose={() => {
        props.onClose()
      }}
    >
      <Show when={props.open}>
        <header class="screen-picker-header">
          <h2 id="screen-picker-title">Что показать</h2>
          <IconButton
            label="Закрыть"
            icon={<X />}
            onClick={() => {
              props.onClose()
            }}
          />
        </header>
        <Switch>
          <Match when={sources.loading && !sources.latest}>
            <p class="screen-picker-note" role="status">
              Поиск экранов и окон…
            </p>
          </Match>
          <Match when={sources.error !== undefined}>
            <p class="screen-picker-note screen-picker-note--problem" role="alert">
              Список экранов получить не удалось.
            </p>
            <Button onClick={() => void refetch()}>Попробовать снова</Button>
          </Match>
          <Match when={sources.latest?.picker === 'denied'}>
            <div class="screen-picker-denied" role="alert">
              <p>
                Нет разрешения на запись экрана. Его можно включить для Ratatosk в «Системные
                настройки → Конфиденциальность и безопасность → Запись экрана»; после этого нужен
                перезапуск приложения.
              </p>
              <Button onClick={() => void access().openPermissionSettings()}>
                Открыть настройки
              </Button>
            </div>
          </Match>
          <Match when={sources.latest?.picker === 'system'}>
            <p class="screen-picker-note">Система сама спросит, какой экран или окно показать.</p>
            <div class="screen-picker-actions">
              <Button
                onClick={() => {
                  props.onClose()
                }}
              >
                Отмена
              </Button>
              <Button
                variant="primary"
                icon={<Monitor />}
                onClick={() => {
                  props.onPick(null)
                }}
              >
                Выбрать экран
              </Button>
            </div>
          </Match>
          <Match when={sources.latest?.picker === 'app'}>
            <div class="screen-picker-tabs" role="tablist" aria-label="Источник">
              <For each={['screen', 'window'] as const}>
                {(kind) => (
                  <button
                    type="button"
                    role="tab"
                    class="screen-picker-tab"
                    aria-selected={tab() === kind}
                    onClick={() => setTab(kind)}
                  >
                    {kind === 'screen' ? 'Экраны' : 'Окна'}
                    <span class="screen-picker-count">{count(kind)}</span>
                  </button>
                )}
              </For>
              {/* A window opened after the dialog, or a display the system listed late. */}
              <IconButton
                class="screen-picker-refresh"
                label="Обновить список"
                icon={<RefreshCw />}
                variant="ghost"
                disabled={sources.loading}
                onClick={() => void refetch()}
              />
            </div>
            <Show
              when={shown().length > 0}
              fallback={
                <p class="screen-picker-note">
                  {tab() === 'screen' ? 'Экраны не найдены.' : 'Открытых окон нет.'}
                </p>
              }
            >
              <div
                class="screen-picker-grid"
                role="radiogroup"
                aria-label={tab() === 'screen' ? 'Экраны' : 'Окна'}
              >
                <For each={shown()}>
                  {(source) => (
                    <button
                      type="button"
                      role="radio"
                      class="screen-picker-source"
                      aria-checked={selected() === source.id}
                      onClick={() => setSelected(source.id)}
                      onDblClick={() => {
                        setSelected(source.id)
                        pick()
                      }}
                    >
                      <span class="screen-picker-thumb">
                        <Show when={source.thumbnail} fallback={<Monitor aria-hidden="true" />}>
                          {(src) => <img src={src()} alt="" width="320" height="180" />}
                        </Show>
                      </span>
                      <span class="screen-picker-name">
                        <Show when={source.icon}>
                          {(icon) => <img src={icon()} alt="" width="16" height="16" />}
                        </Show>
                        <span>{source.name}</span>
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <div class="screen-picker-actions">
              <Button
                onClick={() => {
                  props.onClose()
                }}
              >
                Отмена
              </Button>
              <Button variant="primary" disabled={selected() === null} onClick={pick}>
                Показать
              </Button>
            </div>
          </Match>
        </Switch>
      </Show>
    </dialog>
  )
}
