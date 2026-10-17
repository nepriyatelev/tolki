import Volume2 from 'lucide-solid/icons/volume-2'
import X from 'lucide-solid/icons/x'
import { createEffect, createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js'
import { Button, IconButton, Select } from '../ui'
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
    void window.ratatosk.settings.update({ audio: { outputDeviceId: deviceId } })
  }

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
      </Show>
    </dialog>
  )
}
