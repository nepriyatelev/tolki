import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { installTolkiMock } from '../../../test/tolki-mock'
import { MicCheck } from './MicCheck'
import { MicrophoneError, type MicrophoneAccess } from './microphone'

function fakeMic(options: { fail?: MicrophoneError } = {}) {
  const stops: string[] = []
  const opened: string[] = []
  let emit: (level: number) => void = () => undefined
  const access: MicrophoneAccess = {
    listInputs: () =>
      Promise.resolve([
        { deviceId: 'usb', label: 'USB Audio Device' },
        { deviceId: 'built-in', label: 'Встроенный микрофон' },
      ]),
    listOutputs: () =>
      Promise.resolve([
        { deviceId: 'headphones', label: 'Наушники' },
        { deviceId: 'speakers', label: 'Динамики MacBook' },
      ]),
    openMeter: vi.fn((deviceId: string, onLevel: (level: number) => void) => {
      if (options.fail) return Promise.reject(options.fail)
      opened.push(deviceId)
      emit = onLevel
      return Promise.resolve(() => {
        stops.push(deviceId)
      })
    }),
  }
  return {
    access,
    stops,
    opened,
    level: (l: number) => {
      emit(l)
    },
  }
}

describe('MicCheck', () => {
  it('lights meter segments with the input level', async () => {
    installTolkiMock()
    const mic = fakeMic()
    render(() => <MicCheck muted={false} onMutedChange={() => undefined} access={mic.access} />)
    await vi.waitFor(() => {
      expect(mic.opened).toEqual([''])
    })

    mic.level(0.5)

    const meter = screen.getByRole('meter', { name: 'Уровень микрофона' })
    expect(meter.getAttribute('aria-valuenow')).toBe('10')
    expect(meter.querySelectorAll('.mic-level__segment--on')).toHaveLength(10)
    expect(screen.getByText('При разговоре полоска должна двигаться.')).toBeTruthy()
  })

  it('lists devices once access is granted, remembers the choice and reopens the meter', async () => {
    const user = userEvent.setup()
    installTolkiMock()
    const update = vi.spyOn(window.tolki.settings, 'update')
    const mic = fakeMic()
    render(() => <MicCheck muted={false} onMutedChange={() => undefined} access={mic.access} />)

    await screen.findByRole('option', { name: 'USB Audio Device' })
    await user.selectOptions(screen.getByLabelText('Микрофон'), 'built-in')

    await vi.waitFor(() => {
      expect(mic.opened).toEqual(['', 'built-in'])
    })
    expect(mic.stops).toEqual([''])
    expect(update).toHaveBeenCalledWith({
      audio: { inputDeviceId: 'built-in' },
    })
  })

  it('explains when microphone access is denied', async () => {
    installTolkiMock()
    const mic = fakeMic({ fail: new MicrophoneError('denied') })
    render(() => <MicCheck muted={false} onMutedChange={() => undefined} access={mic.access} />)

    expect((await screen.findByRole('status')).textContent).toContain('Нет доступа к микрофону')
  })

  it('on macOS says why before the system asks for the microphone (#85)', async () => {
    const user = userEvent.setup()
    const api = installTolkiMock({ permissions: { microphone: 'not-asked' } })
    const mic = fakeMic()
    render(() => <MicCheck access={mic.access} />)
    const allow = await screen.findByRole('button', { name: 'Разрешить доступ к микрофону' })
    expect(screen.getByText(/Tolki нужен доступ к микрофону/)).toBeTruthy()
    expect(mic.opened).toEqual([])

    await user.click(allow)
    expect(api.permissions.request).toHaveBeenCalledWith('microphone')
    await vi.waitFor(() => {
      expect(mic.opened).toEqual([''])
    })
  })

  it('opens the system settings when the OS denies the microphone (#85)', async () => {
    const user = userEvent.setup()
    const api = installTolkiMock({ permissions: { microphone: 'denied' } })
    const mic = fakeMic({ fail: new MicrophoneError('denied') })
    render(() => <MicCheck access={mic.access} />)
    expect(await screen.findByText(/Нет доступа к микрофону/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Открыть настройки' }))
    expect(api.permissions.openSettings).toHaveBeenCalledWith('microphone')
  })

  it('tries the microphone even when the OS says «denied» (Windows may be wrong)', async () => {
    installTolkiMock({ permissions: { microphone: 'denied' } })
    const mic = fakeMic()
    render(() => <MicCheck access={mic.access} />)
    await vi.waitFor(() => {
      expect(mic.opened).toEqual([''])
    })
    expect(screen.queryByText(/Нет доступа к микрофону/)).toBeNull()
  })

  it('reports the «join muted» choice', async () => {
    const user = userEvent.setup()
    installTolkiMock()
    const onMutedChange = vi.fn()
    render(() => <MicCheck muted={false} onMutedChange={onMutedChange} access={fakeMic().access} />)

    await user.click(screen.getByRole('checkbox', { name: 'Войти с выключенным микрофоном' }))

    expect(onMutedChange).toHaveBeenCalledWith(true)
  })

  it('stops the microphone when leaving the screen', async () => {
    installTolkiMock()
    const mic = fakeMic()
    const { unmount } = render(() => (
      <MicCheck muted={false} onMutedChange={() => undefined} access={mic.access} />
    ))
    await vi.waitFor(() => {
      expect(mic.opened).toEqual([''])
    })

    unmount()

    expect(mic.stops).toEqual([''])
  })

  it('has no «join muted» checkbox outside the join screen', () => {
    render(() => <MicCheck access={fakeMic().access} />)
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})
