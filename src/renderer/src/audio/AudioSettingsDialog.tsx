import Volume2 from 'lucide-solid/icons/volume-2'
import X from 'lucide-solid/icons/x'
import {
  createEffect,
  createSignal,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
  type JSX,
} from 'solid-js'
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
  /** «Нажмите клавишу…»: the next key pressed becomes the push-to-talk key; Esc cancels. */
  const [capturing, setCapturing] = createSignal(false)
  const capture = (event: KeyboardEvent): void => {
    if (!capturing()) return
    event.preventDefault()
    event.stopPropagation()
    if (event.code === 'Escape') {
      setCapturing(false)
      return
    }
    if (!isPushToTalkKey(event.code)) return
    setCapturing(false)
    savePtt({ ...ptt(), key: event.code }, false)
  }
  createEffect(() => {
    if (!props.open) setCapturing(false)
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
                    capturing()
                      ? 'Нажмите клавишу для разговора'
                      : `Клавиша для разговора: ${pushToTalkKeyLabel(ptt().key)}`
                  }
                  onClick={() => setCapturing(true)}
                >
                  {capturing() ? 'Нажмите клавишу…' : pushToTalkKeyLabel(ptt().key)}
                </Button>
              </div>
              <PushToTalkNote
                mode={props.pushToTalkMode ?? 'off'}
                onOpenSettings={() => void window.tolki.ptt.openPermissionSettings()}
              />
            </Show>
          </section>
        </Show>
      </Show>
    </dialog>
  )
}

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
