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
import type { CaptureSource, ScreenMode, ScreenSourcesResult } from '@shared/screen'
import { createPresence, Button, Checkbox, IconButton, RadioPillGroup } from '../ui'
import { SCREEN_MODE_OPTIONS } from './screen-modes'
import { browserScreen, type ScreenAccess } from './screen-share'
import './ScreenSourceDialog.css'

type Tab = 'screen' | 'window'

/**
 * How long the list may take. Listing windows once blocked the main process for good (#123);
 * after this the dialog says so and offers to try again instead of searching forever.
 */
export const LIST_TIMEOUT_MS = 15_000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('the list of screens did not come in time'))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

/** The list, or (macOS, the first time) a word before macOS asks for «Запись экрана» (#85). */
type DialogSources = ScreenSourcesResult | { picker: 'ask' }

/**
 * «Что показать» (PLAN #26, drawn in code): screens and windows with live previews. On Wayland the
 * system portal asks instead; on macOS without «Запись экрана» it explains how to allow it.
 */
export function ScreenSourceDialog(props: {
  open: boolean
  onClose: () => void
  /** null: the system picker (Wayland) chooses; `systemAudio`: the computer's sound goes too. */
  onPick: (sourceId: string | null, systemAudio: boolean, mode: ScreenMode) => void
  /** What is shown, picked here (#86): the last pick, or the room's mode at first. */
  mode: ScreenMode
  access?: ScreenAccess
}): JSX.Element {
  let dialog: HTMLDialogElement | undefined
  // The content stays while the dialog fades out (#149).
  const presence = createPresence(() => props.open)
  const access = (): ScreenAccess => props.access ?? browserScreen
  const [tab, setTab] = createSignal<Tab>('screen')
  const [selected, setSelected] = createSignal<string | null>(null)
  /** «Звук компьютера» (#41): off at first, as in Zoom; remembered while the app runs. */
  const [withSound, setWithSound] = createSignal(false)
  const soundOffered = (): boolean => {
    const result = sources.latest
    return result?.picker === 'app' && result.systemAudio
  }
  /** The user read why macOS will ask; the first list then brings up its dialog. */
  let askedBefore = false
  // Fresh previews every time the dialog opens.
  const [sources, { refetch }] = createResource(
    () => props.open || undefined,
    async (): Promise<DialogSources> => {
      if (!askedBefore && (await access().permission()) === 'not-asked') return { picker: 'ask' }
      return withTimeout(access().listSources(), LIST_TIMEOUT_MS)
    },
  )
  const openSettings = async (): Promise<void> => {
    await access().openPermissionSettings()
    // Back from the settings: Tolki needs a restart for it (main knows the settings were opened).
    void refetch()
  }

  // eslint-disable-next-line solid/reactivity -- set again from props each time the dialog opens
  const [mode, setMode] = createSignal<ScreenMode>(props.mode)

  createEffect(() => {
    if (!dialog) return
    if (props.open && !dialog.open) {
      setSelected(null)
      setTab('screen')
      setMode(props.mode)
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
    if (id !== null) props.onPick(id, soundOffered() && withSound(), mode())
  }

  return (
    <dialog
      ref={(element) => {
        dialog = element
      }}
      class="screen-picker rt-dialog"
      aria-labelledby="screen-picker-title"
      onClose={() => {
        props.onClose()
      }}
    >
      <Show when={presence.mounted()}>
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
            {/* Placeholders in the list's shape, so nothing jumps when it comes (#110). */}
            <div class="screen-picker-loading" aria-busy="true">
              <p class="visually-hidden" role="status">
                Поиск экранов и окон…
              </p>
              <div class="screen-picker-skeleton-tabs" aria-hidden="true">
                <span class="screen-picker-skeleton" />
                <span class="screen-picker-skeleton" />
              </div>
              <div class="screen-picker-grid" aria-hidden="true">
                <For each={[0, 1, 2]}>
                  {() => (
                    <span class="screen-picker-source screen-picker-source--skeleton">
                      <span class="screen-picker-thumb screen-picker-skeleton" />
                      <span class="screen-picker-skeleton screen-picker-skeleton--line" />
                    </span>
                  )}
                </For>
              </div>
            </div>
          </Match>
          <Match when={sources.error !== undefined}>
            <p class="screen-picker-note screen-picker-note--problem" role="alert">
              Список экранов получить не удалось.
            </p>
            <Button onClick={() => void refetch()}>Попробовать снова</Button>
          </Match>
          <Match when={sources.latest?.picker === 'ask'}>
            <div class="screen-picker-permission">
              <p>
                Чтобы показывать экран, macOS попросит разрешение «Запись экрана» для Tolki. После
                того как оно включено, Tolki нужно перезапустить — система предложит это сама.
              </p>
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
                  onClick={() => {
                    askedBefore = true
                    void refetch()
                  }}
                >
                  Продолжить
                </Button>
              </div>
            </div>
          </Match>
          <Match when={sources.latest?.picker === 'denied'}>
            <div class="screen-picker-denied" role="alert">
              <p>
                Нет разрешения на запись экрана. Его можно включить для Tolki в «Системные настройки
                → Конфиденциальность и безопасность → Запись экрана»; после этого нужен перезапуск
                приложения.
              </p>
              <Button onClick={() => void openSettings()}>Открыть настройки</Button>
            </div>
          </Match>
          <Match when={sources.latest?.picker === 'restart'}>
            <div class="screen-picker-permission" role="alert">
              <p>
                Разрешение «Запись экрана» заработает после перезапуска Tolki. Если оно ещё не
                включено — «Системные настройки → Конфиденциальность и безопасность → Запись
                экрана».
              </p>
              <p class="screen-picker-hint">Перезапуск завершит звонок.</p>
              <div class="screen-picker-actions">
                <Button onClick={() => void openSettings()}>Открыть настройки</Button>
                <Button variant="primary" onClick={() => void access().relaunch()}>
                  Перезапустить Tolki
                </Button>
              </div>
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
                  props.onPick(null, false, mode())
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
            <RadioPillGroup
              legend="Что показываете"
              value={mode()}
              onChange={setMode}
              options={SCREEN_MODE_OPTIONS}
              compact
            />
            <div class="screen-picker-actions">
              <Show when={soundOffered()}>
                <Checkbox
                  class="screen-picker-sound"
                  label="Звук компьютера"
                  description="Видео, игра, музыка — то, что играет на компьютере"
                  checked={withSound()}
                  onChange={(e) => setWithSound(e.currentTarget.checked)}
                />
              </Show>
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
