import { createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js'
import { Checkbox, Select } from '../ui'
import {
  browserMicrophone,
  MicrophoneError,
  type AudioInput,
  type MicrophoneAccess,
  type MicrophoneProblem,
} from './microphone'

export const LEVEL_SEGMENTS = 20

const PROBLEMS: Record<MicrophoneProblem, string> = {
  denied: 'Нет доступа к микрофону. Разреши его в системных настройках и открой экран снова.',
  'not-found': 'Микрофон не найден. Подключи его или войди с выключенным микрофоном.',
  unavailable: 'Микрофон сейчас недоступен — возможно, его заняла другая программа.',
}

/** Microphone picker with a live level meter (mockup 3). */
export function MicCheck(props: {
  muted: boolean
  onMutedChange: (muted: boolean) => void
  access?: MicrophoneAccess
}): JSX.Element {
  const access = (): MicrophoneAccess => props.access ?? browserMicrophone
  const [inputs, setInputs] = createSignal<AudioInput[]>([])
  const [deviceId, setDeviceId] = createSignal<string | undefined>(undefined)
  const [level, setLevel] = createSignal(0)
  const [problem, setProblem] = createSignal<MicrophoneProblem | undefined>(undefined)

  onMount(() => {
    void window.ratatosk.settings.get().then((s) => setDeviceId(s.audio.inputDeviceId))
  })

  // (Re)open the meter whenever the chosen device changes.
  createEffect(() => {
    const id = deviceId()
    if (id === undefined) return
    let stop: (() => void) | undefined
    let cancelled = false
    setProblem(undefined)
    access()
      .openMeter(id, setLevel)
      .then(async (stopMeter) => {
        if (cancelled) {
          stopMeter()
          return
        }
        stop = stopMeter
        // Device names are only visible once access is granted.
        setInputs(await access().listInputs())
      })
      .catch((error: unknown) => {
        setProblem(error instanceof MicrophoneError ? error.problem : 'unavailable')
        setLevel(0)
      })
    onCleanup(() => {
      cancelled = true
      stop?.()
    })
  })

  const choose = (id: string): void => {
    setDeviceId(id)
    void window.ratatosk.settings.update({ audio: { inputDeviceId: id } })
  }

  const lit = () => Math.round(level() * LEVEL_SEGMENTS)

  return (
    <div class="mic-check">
      <Select
        label="Микрофон"
        value={deviceId() ?? ''}
        onChange={(e) => {
          choose(e.currentTarget.value)
        }}
        options={[
          { value: '', label: 'Как в системе' },
          ...inputs().map((i) => ({ value: i.deviceId, label: i.label })),
        ]}
      />
      <div
        class="mic-level"
        role="meter"
        aria-label="Уровень микрофона"
        aria-valuemin={0}
        aria-valuemax={LEVEL_SEGMENTS}
        aria-valuenow={lit()}
      >
        <For each={Array.from({ length: LEVEL_SEGMENTS }, (_, i) => i)}>
          {(i) => (
            <span class="mic-level__segment" classList={{ 'mic-level__segment--on': i < lit() }} />
          )}
        </For>
      </div>
      <Show
        when={problem()}
        fallback={<p class="mic-hint">Скажи что-нибудь — полоска должна двигаться.</p>}
      >
        {(p) => (
          <p class="mic-hint mic-hint--problem" role="status">
            {PROBLEMS[p()]}
          </p>
        )}
      </Show>
      <Checkbox
        label="Войти с выключенным микрофоном"
        checked={props.muted}
        onChange={(e) => {
          props.onMutedChange(e.currentTarget.checked)
        }}
      />
    </div>
  )
}
