import { createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js'
import type { PermissionState } from '@shared/permissions'
import { Button, Checkbox, Select } from '../ui'
import {
  browserMicrophone,
  MicrophoneError,
  type AudioInput,
  type MicrophoneAccess,
  type MicrophoneProblem,
} from './microphone'
import './MicCheck.css'

export const LEVEL_SEGMENTS = 20

const PROBLEMS: Record<MicrophoneProblem, string> = {
  denied: 'Нет доступа к микрофону. Его можно разрешить в системных настройках.',
  'not-found': 'Микрофон не найден. Можно подключить его или войти с выключенным микрофоном.',
  unavailable: 'Микрофон сейчас недоступен — возможно, его заняла другая программа.',
}

/** Microphone picker with a live level meter (mockup 3, «Настройки»). */
export function MicCheck(props: {
  /** The «join muted» checkbox, on the join screen only. */
  muted?: boolean
  onMutedChange?: (muted: boolean) => void
  /** The user picked another microphone (already saved in settings). */
  onDeviceChange?: (deviceId: string) => void
  hint?: string
  access?: MicrophoneAccess
}): JSX.Element {
  const access = (): MicrophoneAccess => props.access ?? browserMicrophone
  const [inputs, setInputs] = createSignal<AudioInput[]>([])
  const [deviceId, setDeviceId] = createSignal<string | undefined>(undefined)
  const [level, setLevel] = createSignal(0)
  const [problem, setProblem] = createSignal<MicrophoneProblem | undefined>(undefined)
  /** The OS permission (#85): on macOS the first time, a word before the system dialog. */
  const [permission, setPermission] = createSignal<PermissionState | undefined>(undefined)
  /** Denied by the OS itself: its settings can be opened (macOS, Windows). */
  const [osDenied, setOsDenied] = createSignal(false)

  onMount(() => {
    void window.tolki.settings.get().then((s) => setDeviceId(s.audio.inputDeviceId))
    void window.tolki.permissions
      .status('microphone')
      .catch((): PermissionState => 'granted')
      .then((state) => {
        setOsDenied(state === 'denied')
        setPermission(state)
      })
  })

  const allow = async (): Promise<void> => {
    const state = await window.tolki.permissions
      .request('microphone')
      .catch(() => 'denied' as const)
    setOsDenied(state === 'denied')
    setPermission(state)
  }

  // (Re)open the meter whenever the chosen device changes.
  createEffect(() => {
    const id = deviceId()
    const state = permission()
    if (id === undefined || state === undefined || state === 'not-asked') return
    // The OS's word is a hint, not the last word (Windows may say «denied» where the browser
    // still gets a microphone): the meter is tried anyway, and a refusal says the rest.
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
    void window.tolki.settings.update({ audio: { inputDeviceId: id } })
    props.onDeviceChange?.(id)
  }

  const lit = () => Math.round(level() * LEVEL_SEGMENTS)

  return (
    <Show
      when={permission() !== 'not-asked'}
      fallback={
        <div class="mic-permission">
          <p>
            Чтобы участники слышали голос, Tolki нужен доступ к микрофону. macOS спросит разрешение
            один раз.
          </p>
          <Button variant="primary" onClick={() => void allow()}>
            Разрешить доступ к микрофону
          </Button>
        </div>
      }
    >
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
              <span
                class="mic-level__segment"
                classList={{ 'mic-level__segment--on': i < lit() }}
              />
            )}
          </For>
        </div>
        <Show
          when={problem()}
          fallback={
            <p class="mic-hint">{props.hint ?? 'При разговоре полоска должна двигаться.'}</p>
          }
        >
          {(p) => (
            <div class="mic-problem">
              <p class="mic-hint mic-hint--problem" role="status">
                {PROBLEMS[p()]}
              </p>
              <Show when={p() === 'denied' && osDenied()}>
                <Button onClick={() => void window.tolki.permissions.openSettings('microphone')}>
                  Открыть настройки
                </Button>
              </Show>
            </div>
          )}
        </Show>
        <Show when={props.onMutedChange}>
          {(onMutedChange) => (
            <Checkbox
              label="Войти с выключенным микрофоном"
              checked={props.muted ?? false}
              onChange={(e) => {
                onMutedChange()(e.currentTarget.checked)
              }}
            />
          )}
        </Show>
      </div>
    </Show>
  )
}
