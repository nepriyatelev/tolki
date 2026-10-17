import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { installRatatoskMock } from '../../../test/ratatosk-mock'
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
    installRatatoskMock()
    const mic = fakeMic()
    render(() => <MicCheck muted={false} onMutedChange={() => undefined} access={mic.access} />)
    await vi.waitFor(() => {
      expect(mic.opened).toEqual([''])
    })

    mic.level(0.5)

    const meter = screen.getByRole('meter', { name: 'Уровень микрофона' })
    expect(meter.getAttribute('aria-valuenow')).toBe('10')
    expect(meter.querySelectorAll('.mic-level__segment--on')).toHaveLength(10)
    expect(screen.getByText('Скажи что-нибудь — полоска должна двигаться.')).toBeTruthy()
  })

  it('lists devices once access is granted, remembers the choice and reopens the meter', async () => {
    const user = userEvent.setup()
    installRatatoskMock()
    const update = vi.spyOn(window.ratatosk.settings, 'update')
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
    installRatatoskMock()
    const mic = fakeMic({ fail: new MicrophoneError('denied') })
    render(() => <MicCheck muted={false} onMutedChange={() => undefined} access={mic.access} />)

    expect((await screen.findByRole('status')).textContent).toContain('Нет доступа к микрофону')
  })

  it('reports the «join muted» choice', async () => {
    const user = userEvent.setup()
    installRatatoskMock()
    const onMutedChange = vi.fn()
    render(() => <MicCheck muted={false} onMutedChange={onMutedChange} access={fakeMic().access} />)

    await user.click(screen.getByRole('checkbox', { name: 'Войти с выключенным микрофоном' }))

    expect(onMutedChange).toHaveBeenCalledWith(true)
  })

  it('stops the microphone when leaving the screen', async () => {
    installRatatoskMock()
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
