import Volume2 from 'lucide-solid/icons/volume-2'
import X from 'lucide-solid/icons/x'
import {
  createEffect,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
  type JSX,
} from 'solid-js'
import {
  acceleratorFromPress,
  acceleratorLabel,
  type HotkeyAction,
  type HotkeyStatus,
} from '@shared/global-hotkeys'
import { isPushToTalkKey, pushToTalkKeyLabel, type PushToTalkMode } from '@shared/push-to-talk'
import { Button, Checkbox, IconButton, Select } from '../ui'
import { MicCheck } from './MicCheck'
import { browserMicrophone, type AudioInput, type MicrophoneAccess } from './microphone'
import { playTestSound as playRealTestSound } from './test-sound'
import './AudioSettingsDialog.css'

/**
 * «Настройки звука» (PLAN §7, drawn in code): microphone with a level meter, speakers or
 * headphones with a test sound. Both switch during a call without reconnecting (#24).
 */
export function AudioSettingsDialog(props: {
  open: boolean
  onClose: () => void
  /** Another microphone was picked (already saved in settings). */
  onInputChange: (deviceId: string) => void
  outputDeviceId: string
  onOutputChange: (deviceId: string) => void
  access?: MicrophoneAccess
  playTestSound?: (outputDeviceId: string) => Promise<void>
  /** Push-to-talk (PLAN #39): on/off and the key; how the key reaches the app now. */
  pushToTalk?: { enabled: boolean; key: string }
  pushToTalkMode?: PushToTalkMode
  /** Already saved in settings; `askPermission`: the user just turned it on. */
  onPushToTalkChange?: (next: { enabled: boolean; key: string }, askPermission: boolean) => void
  /** Global hotkeys (PLAN #40): the accelerators, '' when not set, and how they are held now. */
  globalHotkeys?: Record<HotkeyAction, string>
  hotkeyStatus?: Record<HotkeyAction, HotkeyStatus>
  /** Already saved in settings. */
  onGlobalHotkeysChange?: (next: Record<HotkeyAction, string>) => void
  /** While a combination is being typed here, the registered ones step aside. */
  onHotkeyCapture?: (capturing: boolean) => void
}): JSX.Element {
  let dialog: HTMLDialogElement | undefined
  const access = (): MicrophoneAccess => props.access ?? browserMicrophone
  const [outputs, setOutputs] = createSignal<AudioInput[]>([])
  const [playing, setPlaying] = createSignal(false)

  // The native modal dialog: focus moves inside, Esc closes, the page behind is inert.
  createEffect(() => {
    if (!dialog) return
    if (props.open && !dialog.open) dialog.showModal()
    if (!props.open && dialog.open) dialog.close()
  })

  const refreshOutputs = (): void => {
    void access()
      .listOutputs()
      .then(setOutputs)
      .catch(() => undefined)
  }
  createEffect(() => {
    if (props.open) refreshOutputs()
  })
  // Headphones plugged in or out while the dialog is open.
  onMount(() => {
    const devices = navigator.mediaDevices as MediaDevices | undefined
    devices?.addEventListener('devicechange', refreshOutputs)
    onCleanup(() => devices?.removeEventListener('devicechange', refreshOutputs))
  })

  const chooseOutput = (deviceId: string): void => {
    props.onOutputChange(deviceId)
    void window.tolki.settings.update({ audio: { outputDeviceId: deviceId } })
  }

  const ptt = (): { enabled: boolean; key: string } =>
    props.pushToTalk ?? { enabled: false, key: 'Backquote' }
  const savePtt = (next: { enabled: boolean; key: string }, askPermission: boolean): void => {
    void window.tolki.settings.update({ pushToTalk: next })
    props.onPushToTalkChange?.(next, askPermission)
  }
  const hotkeys = (): Record<HotkeyAction, string> =>
    props.globalHotkeys ?? { mute: '', deafen: '' }
  const saveHotkey = (action: HotkeyAction, accelerator: string): void => {
    const next = { ...hotkeys(), [action]: accelerator }
    void window.tolki.settings.update({ globalHotkeys: { [action]: accelerator } })
    props.onGlobalHotkeysChange?.(next)
  }
  /**
   * «Нажмите клавишу…»: the next key pressed becomes the push-to-talk key or a global hotkey;
   * Esc cancels.
   */
  const [capturing, setCapturingSignal] = createSignal<'ptt' | HotkeyAction | null>(null)
  const [needsModifier, setNeedsModifier] = createSignal(false)
  const setCapturing = (what: 'ptt' | HotkeyAction | null): void => {
    const hotkeyBefore = capturing() === 'mute' || capturing() === 'deafen'
    const hotkeyNow = what === 'mute' || what === 'deafen'
    setCapturingSignal(what)
    setNeedsModifier(false)
    if (hotkeyBefore !== hotkeyNow) props.onHotkeyCapture?.(hotkeyNow)
  }
  const capture = (event: KeyboardEvent): void => {
    const what = capturing()
    if (what === null) return
    event.preventDefault()
    event.stopPropagation()
    if (event.code === 'Escape') {
      setCapturing(null)
      return
    }
    if (what === 'ptt') {
      if (!isPushToTalkKey(event.code)) return
      setCapturing(null)
      savePtt({ ...ptt(), key: event.code }, false)
      return
    }
    // Ctrl, Shift… alone: the combination is still being pressed.
    if (/^(Control|Shift|Alt|Meta)(Left|Right)$/.test(event.code)) return
    const accelerator = acceleratorFromPress(event)
    if (accelerator === null) {
      setNeedsModifier(true)
      return
    }
    setCapturing(null)
    saveHotkey(what, accelerator)
  }
  createEffect(() => {
    if (!props.open) setCapturing(null)
  })
  onMount(() => {
    // Capture phase: before the dialog's own Esc and the call's hotkeys.
    window.addEventListener('keydown', capture, true)
    onCleanup(() => {
      window.removeEventListener('keydown', capture, true)
    })
  })

  const test = async (): Promise<void> => {
    setPlaying(true)
    try {
      await (props.playTestSound ?? playRealTestSound)(props.outputDeviceId)
    } catch (error) {
      console.warn('[settings] could not play the test sound:', error)
    } finally {
      setPlaying(false)
    }
  }

  return (
    <dialog
      ref={(element) => {
        dialog = element
      }}
      class="audio-settings"
      aria-labelledby="audio-settings-title"
      onClose={() => {
        props.onClose()
      }}
    >
      <Show when={props.open}>
        <header class="audio-settings-header">
          <h2 id="audio-settings-title">Настройки звука</h2>
          <IconButton
            label="Закрыть"
            icon={<X />}
            onClick={() => {
              props.onClose()
            }}
          />
        </header>
        <section class="audio-settings-section">
          <MicCheck
            hint="Меняется сразу, без переподключения к комнате."
            onDeviceChange={(id) => {
              props.onInputChange(id)
            }}
            access={access()}
          />
        </section>
        <section class="audio-settings-section">
          <Select
            label="Динамики или наушники"
            value={props.outputDeviceId}
            onChange={(e) => {
              chooseOutput(e.currentTarget.value)
            }}
            options={[
              { value: '', label: 'Как в системе' },
              ...outputs().map((o) => ({ value: o.deviceId, label: o.label })),
            ]}
          />
          <Button icon={<Volume2 />} disabled={playing()} onClick={() => void test()}>
            {playing() ? 'Играет…' : 'Проверить звук'}
          </Button>
        </section>
        <Show when={props.onPushToTalkChange}>
          <section class="audio-settings-section" aria-label="Режим микрофона">
            <Checkbox
              label="Говорить, только пока нажата клавиша"
              checked={ptt().enabled}
              onChange={(e) => {
                savePtt({ ...ptt(), enabled: e.currentTarget.checked }, e.currentTarget.checked)
              }}
            />
            <Show when={ptt().enabled}>
              <div class="audio-settings-ptt-key">
                <span>Клавиша</span>
                <Button
                  aria-label={
                    capturing() === 'ptt'
                      ? 'Нажмите клавишу для разговора'
                      : `Клавиша для разговора: ${pushToTalkKeyLabel(ptt().key)}`
                  }
                  onClick={() => {
                    setCapturing('ptt')
                  }}
                >
                  {capturing() === 'ptt' ? 'Нажмите клавишу…' : pushToTalkKeyLabel(ptt().key)}
                </Button>
              </div>
              <PushToTalkNote
                mode={props.pushToTalkMode ?? 'off'}
                onOpenSettings={() => void window.tolki.ptt.openPermissionSettings()}
              />
            </Show>
          </section>
        </Show>
        <Show when={props.onGlobalHotkeysChange}>
          <section class="audio-settings-section" aria-label="Клавиши в любом окне">
            <h3 class="audio-settings-subtitle">Клавиши в любом окне</h3>
            <For each={HOTKEY_ROWS}>
              {(row) => (
                <div class="audio-settings-hotkey">
                  <span>{row.title}</span>
                  <span class="audio-settings-hotkey-actions">
                    <Button
                      aria-label={
                        capturing() === row.action
                          ? `Нажмите сочетание: ${row.title.toLowerCase()}`
                          : `${row.title}: ${hotkeys()[row.action] ? acceleratorLabel(hotkeys()[row.action]) : 'не задано'}`
                      }
                      onClick={() => {
                        setCapturing(row.action)
                      }}
                    >
                      {capturing() === row.action
                        ? 'Нажмите сочетание…'
                        : hotkeys()[row.action]
                          ? acceleratorLabel(hotkeys()[row.action])
                          : 'Задать'}
                    </Button>
                    <Show when={hotkeys()[row.action] && capturing() !== row.action}>
                      <IconButton
                        variant="ghost"
                        label={`Убрать: ${row.title.toLowerCase()}`}
                        icon={<X />}
                        onClick={() => {
                          saveHotkey(row.action, '')
                        }}
                      />
                    </Show>
                  </span>
                  <Show when={props.hotkeyStatus?.[row.action] === 'taken'}>
                    <p class="audio-settings-note audio-settings-note--bad">
                      Это сочетание занято другим приложением — нужно другое.
                    </p>
                  </Show>
                </div>
              )}
            </For>
            <p class="audio-settings-note">
              {needsModifier()
                ? 'Нужно сочетание с Ctrl, Alt или Cmd — иначе клавиша срабатывала бы при наборе текста. Esc — отмена.'
                : 'Работают в звонке, даже когда окно Tolki не активно.'}
            </p>
          </section>
        </Show>
      </Show>
    </dialog>
  )
}

const HOTKEY_ROWS: { action: HotkeyAction; title: string }[] = [
  { action: 'mute', title: 'Микрофон' },
  { action: 'deafen', title: 'Звук' },
]

/** How the key works now: everywhere, only in this window, or after a permission on macOS. */
function PushToTalkNote(props: { mode: PushToTalkMode; onOpenSettings: () => void }): JSX.Element {
  return (
    <Switch>
      <Match when={props.mode === 'global'}>
        <p class="audio-settings-note">Работает и поверх других окон, в том числе в играх.</p>
      </Match>
      <Match when={props.mode === 'focus'}>
        <p class="audio-settings-note">Работает, только когда окно Tolki активно.</p>
      </Match>
      <Match when={props.mode === 'needs-permission'}>
        <p class="audio-settings-note">
          Пока работает, только когда окно Tolki активно. Чтобы клавиша работала и поверх других
          окон, разрешите Tolki в «Системные настройки → Конфиденциальность и безопасность →
          Универсальный доступ».
        </p>
        <Button
          onClick={() => {
            props.onOpenSettings()
          }}
        >
          Открыть настройки
        </Button>
      </Match>
    </Switch>
  )
}
