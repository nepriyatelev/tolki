import { fireEvent, render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { JoinResult } from '@shared/room'
import { installRatatoskMock } from '../../../test/ratatosk-mock'
import type { MicrophoneAccess } from '../audio/microphone'
import { collectRoomEvents } from './call'
import { CallScreen, peopleCount, SPEAKING_HOLD_MS } from './CallScreen'

const RESULT: Extract<JoinResult, { ok: true }> = {
  ok: true,
  peerId: 'me',
  peers: [{ id: 'dima', name: 'Дима' }],
  room: { name: 'Вечерний созвон', peerCount: 1, hasPassword: false },
  routerRtpCapabilities: {},
  mutedPeers: [],
}

const FAKE_DEVICES: MicrophoneAccess = {
  listInputs: () =>
    Promise.resolve([
      { deviceId: 'usb', label: 'USB-микрофон' },
      { deviceId: 'built-in', label: 'Встроенный микрофон' },
    ]),
  listOutputs: () =>
    Promise.resolve([
      { deviceId: 'headphones', label: 'Наушники' },
      { deviceId: 'speakers', label: 'Динамики' },
    ]),
  openMeter: () => Promise.resolve(() => undefined),
}

function setup(
  options: {
    muted?: boolean
    sending?: boolean
    mutedPeers?: string[]
    peerVolumes?: Record<string, number>
  } = {},
) {
  const api = installRatatoskMock({ peerVolumes: options.peerVolumes ?? {} })
  const close = vi.fn()
  const setMuted = vi.fn<(muted: boolean) => Promise<void>>(() => Promise.resolve())
  const setInputDevice = vi.fn<(deviceId: string) => Promise<void>>(() => Promise.resolve())
  const onLeft = vi.fn()
  const events = collectRoomEvents()
  const playTestSound = vi.fn<(outputDeviceId: string) => Promise<void>>(() => Promise.resolve())
  render(() => (
    <CallScreen
      microphone={FAKE_DEVICES}
      playTestSound={playTestSound}
      session={{
        result: { ...RESULT, mutedPeers: options.mutedPeers ?? [] },
        events,
        name: 'Алексей',
        muted: options.muted ?? false,
      }}
      onLeft={onLeft}
      startCall={() =>
        Promise.resolve({ sending: options.sending ?? true, setMuted, setInputDevice, close })
      }
    />
  ))
  const labels = () =>
    within(screen.getByRole('list', { name: 'Участники' }))
      .getAllByRole('listitem')
      .map((tile) => tile.getAttribute('aria-label'))
  return {
    api,
    close,
    setMuted,
    setInputDevice,
    playTestSound,
    onLeft,
    labels,
    user: userEvent.setup(),
  }
}

describe('CallScreen', () => {
  it('shows a tile for everyone, the user last', async () => {
    const { labels } = setup()

    expect(screen.getByRole('heading', { name: 'Вечерний созвон' })).toBeTruthy()
    expect(labels()).toEqual(['Дима', 'Алексей (ты)'])
    expect(await screen.findByText('Звук подключён')).toBeTruthy()
  })

  it('frames whoever is speaking, and lets the frame linger briefly after', () => {
    vi.useFakeTimers()
    const { api, labels } = setup()

    api.room.emitEvent({ type: 'active-speakers', peerIds: ['dima'] })
    expect(labels()).toEqual(['Дима, говорит', 'Алексей (ты)'])
    expect(document.querySelector('[data-peer-id="dima"]')?.classList).toContain(
      'call-tile--speaking',
    )

    api.room.emitEvent({ type: 'active-speakers', peerIds: ['me'] })
    expect(labels()).toEqual(['Дима, говорит', 'Алексей (ты), говорит'])
    vi.advanceTimersByTime(SPEAKING_HOLD_MS)
    expect(labels()).toEqual(['Дима', 'Алексей (ты), говорит'])

    api.room.emitEvent({ type: 'active-speakers', peerIds: [] })
    vi.advanceTimersByTime(SPEAKING_HOLD_MS)
    expect(document.querySelector('.call-tile--speaking')).toBeNull()
    vi.useRealTimers()
  })

  it('does not blink between words', () => {
    vi.useFakeTimers()
    const { api } = setup()
    const framed = () =>
      document.querySelector('[data-peer-id="dima"]')?.classList.contains('call-tile--speaking')

    api.room.emitEvent({ type: 'active-speakers', peerIds: ['dima'] })
    api.room.emitEvent({ type: 'active-speakers', peerIds: [] })
    vi.advanceTimersByTime(300)
    expect(framed()).toBe(true)
    api.room.emitEvent({ type: 'active-speakers', peerIds: ['dima'] })
    vi.advanceTimersByTime(SPEAKING_HOLD_MS)
    expect(framed()).toBe(true)
    vi.useRealTimers()
  })

  it('adds and removes people as they come and go', () => {
    const { api, labels } = setup()

    api.room.emitEvent({ type: 'peer-joined', peer: { id: 'katya', name: 'Катя' } })
    expect(labels()).toEqual(['Дима', 'Катя', 'Алексей (ты)'])
    api.room.emitEvent({ type: 'peer-left', peerId: 'dima' })
    expect(labels()).toEqual(['Катя', 'Алексей (ты)'])
  })

  it('marks the user’s tile when joined muted', () => {
    setup({ muted: true })
    expect(screen.getByRole('img', { name: 'Микрофон выключен' })).toBeTruthy()
  })

  it('leaves the room and ends the call', async () => {
    const { api, close, onLeft, user } = setup()
    await screen.findByText('Звук подключён')

    await user.click(screen.getByRole('button', { name: 'Выйти' }))

    expect(close).toHaveBeenCalledOnce()
    expect(api.room.leave).toHaveBeenCalledOnce()
    expect(onLeft).toHaveBeenCalledOnce()
  })
})

describe('microphone and sound (#22)', () => {
  const mic = () => screen.getByRole('button', { name: /микрофон$/ })
  const sound = () => screen.getByRole('button', { name: /звук$/ })
  const ownBadge = () =>
    document.querySelector('[data-peer-id="me"] [aria-label="Микрофон выключен"]')

  it('mutes and unmutes with the button', async () => {
    const { setMuted, user } = setup()
    await screen.findByText('Звук подключён')

    await user.click(screen.getByRole('button', { name: 'Выключить микрофон' }))
    expect(setMuted).toHaveBeenLastCalledWith(true)
    expect(mic().getAttribute('aria-pressed')).toBe('true')
    expect(ownBadge()).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'Включить микрофон' }))
    expect(setMuted).toHaveBeenLastCalledWith(false)
    expect(ownBadge()).toBeNull()
  })

  it('deafening silences the voices and mutes; undeafening restores the microphone', async () => {
    const { setMuted, user } = setup()
    await screen.findByText('Звук подключён')

    await user.click(screen.getByRole('button', { name: 'Выключить звук' }))
    expect(sound().getAttribute('aria-pressed')).toBe('true')
    expect(setMuted).toHaveBeenLastCalledWith(true)
    expect(screen.getByRole('button', { name: 'Включить микрофон' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Включить звук' }))
    expect(setMuted).toHaveBeenLastCalledWith(false)
    expect(screen.getByRole('button', { name: 'Выключить микрофон' })).toBeTruthy()
  })

  it('keeps the microphone off after undeafening if it was off before', async () => {
    const { setMuted, user } = setup({ muted: true })
    await screen.findByText('Звук подключён')

    await user.click(screen.getByRole('button', { name: 'Выключить звук' }))
    await user.click(screen.getByRole('button', { name: 'Включить звук' }))

    expect(setMuted).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Включить микрофон' })).toBeTruthy()
  })

  it('turning the microphone on while deafened brings the sound back', async () => {
    const { user } = setup()
    await screen.findByText('Звук подключён')
    await user.click(screen.getByRole('button', { name: 'Выключить звук' }))

    await user.click(screen.getByRole('button', { name: 'Включить микрофон' }))

    expect(screen.getByRole('button', { name: 'Выключить звук' })).toBeTruthy()
  })

  it('answers the M and D keys, also on the Russian layout, but not while typing', async () => {
    const { setMuted, user } = setup()
    await screen.findByText('Звук подключён')

    await user.keyboard('m')
    expect(setMuted).toHaveBeenLastCalledWith(true)
    // The Russian layout: the same key types «ь».
    fireEvent.keyDown(window, { key: 'ь', code: 'KeyM' })
    expect(setMuted).toHaveBeenLastCalledWith(false)
    await user.keyboard('d')
    expect(sound().getAttribute('aria-pressed')).toBe('true')

    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    await user.keyboard('d')
    expect(sound().getAttribute('aria-pressed')).toBe('true')
    input.remove()

    // A focused volume slider does not swallow the hotkeys.
    await user.click(screen.getByRole('button', { name: 'Меню: Дима' }))
    screen.getByRole('slider', { name: 'Громкость: Дима' }).focus()
    await user.keyboard('d')
    expect(sound().getAttribute('aria-pressed')).toBe('false')
  })

  it('cannot unmute without a microphone', async () => {
    setup({ sending: false })
    await screen.findByText('Микрофон недоступен — ты только слушаешь')
    expect(mic()).toHaveProperty('disabled', true)
  })

  it('shows who else has the microphone off', () => {
    const { api } = setup({ mutedPeers: ['dima'] })
    const badge = () =>
      document.querySelector('[data-peer-id="dima"] [aria-label="Микрофон выключен"]')
    expect(badge()).not.toBeNull()

    api.room.emitEvent({ type: 'peer-muted', peerId: 'dima', muted: false })
    expect(badge()).toBeNull()
    api.room.emitEvent({ type: 'peer-muted', peerId: 'dima', muted: true })
    expect(badge()).not.toBeNull()
  })
})

describe('volume of each participant: the «⋯» menu (#23, #77)', () => {
  const slider = () => screen.getByRole<HTMLInputElement>('slider', { name: 'Громкость: Дима' })
  async function openMenu(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Меню: Дима' }))
    return screen.getByRole('dialog', { name: 'Звук: Дима' })
  }

  it('opens from «⋯» with a 0–200 % slider at the remembered volume', async () => {
    const { user } = setup({ peerVolumes: { дима: 150 } })
    await screen.findByText('Звук подключён')
    const button = screen.getByRole('button', { name: 'Меню: Дима' })
    expect(button.getAttribute('aria-expanded')).toBe('false')

    const menu = await openMenu(user)

    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(slider().value).toBe('150')
    expect(slider().max).toBe('200')
    expect(document.activeElement).toBe(slider())
    expect(within(menu).getByText('150%')).toBeTruthy()
  })

  it('shows a changed volume on the tile', async () => {
    const { labels } = setup({ peerVolumes: { дима: 150 } })
    await vi.waitFor(() => {
      expect(labels()).toEqual(['Дима, громкость 150 %', 'Алексей (ты)'])
    })
  })

  it('remembers a new volume by name when the slider is released, and resets to 100 %', async () => {
    const { api, user } = setup()
    await screen.findByText('Звук подключён')
    const menu = await openMenu(user)
    const reset = within(menu).getByRole<HTMLButtonElement>('button', {
      name: 'Сбросить до 100 %',
    })
    expect(reset.disabled).toBe(true)

    fireEvent.input(slider(), { target: { value: '60' } })
    expect(within(menu).getByText('60%')).toBeTruthy()
    expect(api.settings.update).not.toHaveBeenCalled()
    fireEvent.change(slider(), { target: { value: '60' } })
    expect(api.settings.update).toHaveBeenCalledWith({ audio: { peerVolumes: { Дима: 60 } } })

    await user.click(reset)
    expect(api.settings.update).toHaveBeenLastCalledWith({
      audio: { peerVolumes: { Дима: 100 } },
    })
    expect(slider().value).toBe('100')
  })

  it('closes with Esc and gives focus back to «⋯»', async () => {
    const { user } = setup()
    await screen.findByText('Звук подключён')
    const button = screen.getByRole('button', { name: 'Меню: Дима' })
    const menu = await openMenu(user)

    menu.hidePopover()

    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(button)
  })

  it('offers the audio settings on your own tile', async () => {
    const { user } = setup()
    await screen.findByText('Звук подключён')
    await user.click(screen.getByRole('button', { name: 'Меню: Алексей' }))
    await user.click(screen.getByRole('button', { name: 'Настройки звука' }))
    expect(screen.getByRole('dialog', { name: 'Настройки звука' })).toBeTruthy()
  })

  it('counts the people in the header', () => {
    const { api } = setup()
    expect(screen.getByText('2 участника')).toBeTruthy()
    api.room.emitEvent({ type: 'peer-left', peerId: 'dima' })
    expect(screen.getByText('1 участник')).toBeTruthy()
    expect(peopleCount(5)).toBe('5 участников')
    expect(peopleCount(21)).toBe('21 участник')
  })

  it('says in the tile label when someone has the microphone off', () => {
    const { labels } = setup({ mutedPeers: ['dima'] })
    expect(labels()).toEqual(['Дима, микрофон выключен', 'Алексей (ты)'])
  })
})

describe('«Настройки звука» during a call (#24)', () => {
  async function openSettings() {
    const ctx = setup()
    await screen.findByText('Звук подключён')
    await ctx.user.click(screen.getByRole('button', { name: 'Настройки' }))
    const dialog = screen.getByRole('dialog', { name: 'Настройки звука' })
    return { ...ctx, dialog }
  }

  it('switches the microphone on the fly and remembers it', async () => {
    const { api, setInputDevice, dialog, user } = await openSettings()
    const mic = within(dialog).getByLabelText('Микрофон')
    await within(mic).findByRole('option', { name: 'USB-микрофон' })

    await user.selectOptions(mic, 'usb')

    expect(setInputDevice).toHaveBeenCalledWith('usb')
    expect(api.settings.update).toHaveBeenCalledWith({ audio: { inputDeviceId: 'usb' } })
  })

  it('switches the output, remembers it, and plays the test sound there', async () => {
    const { api, playTestSound, dialog, user } = await openSettings()
    const output = within(dialog).getByLabelText('Динамики или наушники')
    await within(output).findByRole('option', { name: 'Наушники' })

    await user.selectOptions(output, 'headphones')
    expect(api.settings.update).toHaveBeenCalledWith({ audio: { outputDeviceId: 'headphones' } })

    await user.click(within(dialog).getByRole('button', { name: 'Проверить звук' }))
    expect(playTestSound).toHaveBeenCalledWith('headphones')
  })

  it('closes, and hotkeys stay quiet while it is open', async () => {
    const { setMuted, dialog, user } = await openSettings()

    await user.keyboard('m')
    expect(setMuted).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Закрыть' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await user.keyboard('m')
    expect(setMuted).toHaveBeenCalledWith(true)
  })
})
