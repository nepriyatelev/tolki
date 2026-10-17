import { fireEvent, render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { JoinResult } from '@shared/room'
import { installRatatoskMock } from '../../../test/ratatosk-mock'
import { collectRoomEvents } from './call'
import { CallScreen } from './CallScreen'

const RESULT: Extract<JoinResult, { ok: true }> = {
  ok: true,
  peerId: 'me',
  peers: [{ id: 'dima', name: 'Дима' }],
  room: { name: 'Вечерний созвон', peerCount: 1, hasPassword: false },
  routerRtpCapabilities: {},
  mutedPeers: [],
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
  const onLeft = vi.fn()
  const events = collectRoomEvents()
  render(() => (
    <CallScreen
      session={{
        result: { ...RESULT, mutedPeers: options.mutedPeers ?? [] },
        events,
        name: 'Алексей',
        muted: options.muted ?? false,
      }}
      onLeft={onLeft}
      startCall={() => Promise.resolve({ sending: options.sending ?? true, setMuted, close })}
    />
  ))
  const labels = () =>
    within(screen.getByRole('list', { name: 'Участники' }))
      .getAllByRole('listitem')
      .map((tile) => tile.getAttribute('aria-label'))
  return { api, close, setMuted, onLeft, labels, user: userEvent.setup() }
}

describe('CallScreen', () => {
  it('shows a tile for everyone, the user last', async () => {
    const { labels } = setup()

    expect(screen.getByRole('heading', { name: 'Вечерний созвон' })).toBeTruthy()
    expect(labels()).toEqual(['Дима', 'Алексей (ты)'])
    expect(await screen.findByText('Звук подключён')).toBeTruthy()
  })

  it('frames whoever is speaking', () => {
    const { api, labels } = setup()

    api.room.emitEvent({ type: 'active-speakers', peerIds: ['dima'] })
    expect(labels()).toEqual(['Дима, говорит', 'Алексей (ты)'])
    expect(document.querySelector('[data-peer-id="dima"]')?.classList).toContain(
      'call-tile--speaking',
    )

    api.room.emitEvent({ type: 'active-speakers', peerIds: ['me'] })
    expect(labels()).toEqual(['Дима', 'Алексей (ты), говорит'])

    api.room.emitEvent({ type: 'active-speakers', peerIds: [] })
    expect(document.querySelector('.call-tile--speaking')).toBeNull()
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

describe('volume of each participant (#23)', () => {
  const slider = (name: string) =>
    screen.getByRole<HTMLInputElement>('slider', { name: `Громкость: ${name}` })

  it('lists the others with a 0–200 % slider, starting from the remembered volume', async () => {
    setup({ peerVolumes: { дима: 150 } })

    expect(screen.getByRole('heading', { name: 'В комнате · 2' })).toBeTruthy()
    await vi.waitFor(() => {
      expect(slider('Дима').value).toBe('150')
    })
    expect(slider('Дима').min).toBe('0')
    expect(slider('Дима').max).toBe('200')
    expect(screen.getByText('150%')).toBeTruthy()
    expect(screen.queryByRole('slider', { name: 'Громкость: Алексей' })).toBeNull()
  })

  it('remembers a new volume by name when the slider is released', async () => {
    const { api } = setup()
    await screen.findByText('100%')

    fireEvent.input(slider('Дима'), { target: { value: '60' } })
    expect(screen.getByText('60%')).toBeTruthy()
    expect(api.settings.update).not.toHaveBeenCalled()
    fireEvent.change(slider('Дима'), { target: { value: '60' } })

    expect(api.settings.update).toHaveBeenCalledWith({ audio: { peerVolumes: { Дима: 60 } } })
  })

  it('says when someone has the microphone off', () => {
    setup({ mutedPeers: ['dima'] })
    expect(screen.getByText('микрофон выкл.')).toBeTruthy()
  })

  it('says when nobody else is here', () => {
    const { api } = setup()
    api.room.emitEvent({ type: 'peer-left', peerId: 'dima' })
    expect(screen.getByText('Пока никого нет')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'В комнате · 1' })).toBeTruthy()
  })
})
