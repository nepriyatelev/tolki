import type { Cue } from '../audio/cue-sounds'
import type { PushToTalkMode } from '@shared/push-to-talk'
import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PermissionKind, PermissionState } from '@shared/permissions'
import type { JoinResult } from '@shared/room'
import { installTolkiMock } from '../../../test/tolki-mock'
import { CHROME_HIDE_MS } from './ScreenStage'
import type { ScreenMode, ScreenSourcesResult } from '@shared/screen'
import type { MicrophoneAccess } from '../audio/microphone'
import {
  collectRoomEvents,
  type ConnectionSample,
  type RemoteScreen,
  type ScreenSample,
} from './call'
import {
  CallScreen,
  MUTED_SPEECH_LEVEL,
  MUTED_SPEECH_MS,
  peopleCount,
  SPEAKING_HOLD_MS,
} from './CallScreen'
import { LIST_TIMEOUT_MS } from '../screen/ScreenSourceDialog'

const RESULT: Extract<JoinResult, { ok: true }> = {
  ok: true,
  peerId: 'me',
  peers: [{ id: 'dima', name: 'Дима' }],
  room: { name: 'Вечерний созвон', peerCount: 1, hasPassword: false },
  routerRtpCapabilities: {},
  mutedPeers: [],
  screenMode: 'auto',
  sharerId: null,
  organizer: false,
  approval: false,
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

const SCREENS: ScreenSourcesResult = {
  picker: 'app',
  sources: [
    { id: 'screen:1:0', name: 'Экран 1', kind: 'screen', thumbnail: 'data:a', icon: null },
    { id: 'screen:2:0', name: 'Экран 2', kind: 'screen', thumbnail: 'data:b', icon: null },
    { id: 'window:42:0', name: 'Редактор', kind: 'window', thumbnail: 'data:c', icon: 'data:i' },
  ],
  systemAudio: false,
}

function fakeScreen(
  sources: ScreenSourcesResult = SCREENS,
  permission: PermissionState = 'granted',
) {
  const stop = vi.fn()
  /** The computer's sound (#41) when asked for. */
  const sound = { kind: 'audio', stop: vi.fn() }
  let withSound = false
  let ended: () => void = () => undefined
  const track = {
    stop,
    addEventListener: (_type: string, listener: () => void) => {
      ended = listener
    },
  }
  const stream = {
    getTracks: () => (withSound ? [track, sound] : [track]),
    getVideoTracks: () => [track],
    getAudioTracks: () => (withSound ? [sound] : []),
  } as unknown as MediaStream
  const access = {
    listSources: vi.fn(() => Promise.resolve(sources)),
    capture: vi.fn<(id: string | null, systemAudio: boolean) => Promise<MediaStream>>(
      (_id, systemAudio) => {
        withSound = systemAudio
        return Promise.resolve(stream)
      },
    ),
    permission: vi.fn(() => Promise.resolve(permission)),
    openPermissionSettings: vi.fn(() => Promise.resolve()),
    relaunch: vi.fn(() => Promise.resolve()),
  }
  return {
    access,
    stop,
    sound,
    end: () => {
      ended()
    },
  }
}

function setup(
  options: {
    muted?: boolean
    sending?: boolean
    mutedPeers?: string[]
    peerVolumes?: Record<string, number>
    screenSources?: ScreenSourcesResult
    sharerId?: string | null
    screenPermission?: PermissionState
    permissions?: Partial<Record<PermissionKind, PermissionState>>
    screenMode?: ScreenMode
    roomScreenMode?: ScreenMode
    keysHint?: boolean
    pushToTalk?: { enabled: boolean; key: string }
    pushToTalkMode?: PushToTalkMode
    globalHotkeys?: { mute: string; deafen: string }
    takenHotkeys?: string[]
    organizer?: boolean
    approval?: boolean
  } = {},
  playCue = vi.fn<(cue: Cue, outputDeviceId: string) => Promise<void>>(() => Promise.resolve()),
) {
  const api = installTolkiMock({
    peerVolumes: options.peerVolumes ?? {},
    ...(options.pushToTalk ? { pushToTalk: options.pushToTalk } : {}),
    ...(options.pushToTalkMode ? { pushToTalkMode: options.pushToTalkMode } : {}),
    ...(options.globalHotkeys ? { globalHotkeys: options.globalHotkeys } : {}),
    ...(options.takenHotkeys ? { takenHotkeys: options.takenHotkeys } : {}),
    ...(options.permissions ? { permissions: options.permissions } : {}),
    ...(options.screenMode ? { screenMode: options.screenMode } : {}),
    ...(options.keysHint ? { keysHint: true } : {}),
  })
  const close = vi.fn()
  const setMuted = vi.fn<(muted: boolean) => Promise<void>>(() => Promise.resolve())
  const setTransmitting = vi.fn<(on: boolean) => void>()
  const setInputDevice = vi.fn<(deviceId: string) => Promise<void>>(() => Promise.resolve())
  const startScreen = vi.fn<
    (track: MediaStreamTrack, mode: ScreenMode, audio?: unknown) => Promise<void>
  >(() => Promise.resolve())
  const stopScreen = vi.fn(() => Promise.resolve())
  const setScreenBudget = vi.fn<(budget: { height: number; maxBitrate: number }) => Promise<void>>(
    () => Promise.resolve(),
  )
  const setScreenVisible = vi.fn<(consumerId: string, visible: boolean) => Promise<void>>(() =>
    Promise.resolve(),
  )
  const setScreenLayer = vi.fn<(consumerId: string, layer: 0 | 1) => Promise<void>>(() =>
    Promise.resolve(),
  )
  let showScreens: (screens: RemoteScreen[]) => void = () => undefined
  const requestScreen = vi.fn(() => Promise.resolve())
  const answerScreenRequest = vi.fn<(fromPeerId: string, accept: boolean) => Promise<void>>(() =>
    Promise.resolve(),
  )
  const screenSample = vi.fn<(consumerId: string | null) => Promise<ScreenSample | null>>(() =>
    Promise.resolve(null),
  )
  const connectionSample = vi.fn<() => Promise<ConnectionSample | null>>(() =>
    Promise.resolve({ rttMs: 24, protocol: 'udp', packetsReceived: 100, packetsLost: 0 }),
  )
  let micLevel: (level: number) => void = () => undefined
  const meterMicrophone = vi.fn((onLevel: (level: number) => void) => {
    micLevel = onLevel
    return () => undefined
  })
  const onLeft = vi.fn()
  const events = collectRoomEvents()
  const playTestSound = vi.fn<(outputDeviceId: string) => Promise<void>>(() => Promise.resolve())
  const screenAccess = fakeScreen(options.screenSources, options.screenPermission)
  render(() => (
    <CallScreen
      microphone={FAKE_DEVICES}
      screen={screenAccess.access}
      playCue={playCue}
      playTestSound={playTestSound}
      session={{
        result: {
          ...RESULT,
          mutedPeers: options.mutedPeers ?? [],
          sharerId: options.sharerId ?? null,
          organizer: options.organizer ?? false,
          approval: options.approval ?? false,
          screenMode: options.roomScreenMode ?? 'auto',
        },
        events,
        name: 'Алексей',
        muted: options.muted ?? false,
      }}
      onLeft={onLeft}
      startCall={(callOptions) => {
        showScreens = callOptions.onRemoteScreens
        return Promise.resolve({
          sending: options.sending ?? true,
          setMuted,
          setTransmitting,
          setInputDevice,
          startScreen,
          stopScreen,
          setScreenBudget,
          setScreenVisible,
          setScreenLayer,
          requestScreen,
          answerScreenRequest,
          screenSample,
          connectionSample,
          meterMicrophone,
          close,
        })
      }}
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
    setTransmitting,
    setInputDevice,
    startScreen,
    stopScreen,
    setScreenBudget,
    setScreenVisible,
    setScreenLayer,
    requestScreen,
    answerScreenRequest,
    screenSample,
    connectionSample,
    showScreens: (screens: RemoteScreen[]) => {
      showScreens(screens)
    },
    micLevel: (level: number) => {
      micLevel(level)
    },
    playTestSound,
    playCue,
    screen: screenAccess,
    onLeft,
    labels,
    user: userEvent.setup(),
  }
}

describe('CallScreen', () => {
  it('shows a tile for everyone, the user last', async () => {
    const { labels } = setup()

    expect(screen.getByRole('heading', { name: 'Вечерний созвон' })).toBeTruthy()
    expect(labels()).toEqual(['Дима', 'Алексей (я)'])
    expect(await screen.findByText('Звук подключён')).toBeTruthy()
  })

  it('frames whoever is speaking, and lets the frame linger briefly after', () => {
    vi.useFakeTimers()
    const { api, labels } = setup()

    api.room.emitEvent({ type: 'active-speakers', peerIds: ['dima'] })
    expect(labels()).toEqual(['Дима, говорит', 'Алексей (я)'])
    expect(document.querySelector('[data-peer-id="dima"]')?.classList).toContain(
      'call-tile--speaking',
    )

    api.room.emitEvent({ type: 'active-speakers', peerIds: ['me'] })
    expect(labels()).toEqual(['Дима, говорит', 'Алексей (я), говорит'])
    vi.advanceTimersByTime(SPEAKING_HOLD_MS)
    expect(labels()).toEqual(['Дима', 'Алексей (я), говорит'])

    api.room.emitEvent({ type: 'active-speakers', peerIds: [] })
    vi.advanceTimersByTime(SPEAKING_HOLD_MS)
    expect(document.querySelector('.call-tile--speaking')).toBeNull()
    vi.useRealTimers()
  })

  it('counts the time in the call: mm:ss, then h:mm:ss (#80)', () => {
    vi.useFakeTimers()
    setup()
    const timer = () => screen.getByLabelText('Время в звонке').textContent

    expect(timer()).toBe('00:00')
    vi.advanceTimersByTime(65_000)
    expect(timer()).toBe('01:05')
    vi.advanceTimersByTime(3_600_000)
    expect(timer()).toBe('1:01:05')
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
    expect(labels()).toEqual(['Дима', 'Катя', 'Алексей (я)'])
    api.room.emitEvent({ type: 'peer-left', peerId: 'dima' })
    expect(labels()).toEqual(['Катя', 'Алексей (я)'])
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

describe('the organizer closes the room only after one more step (#149)', () => {
  it('asks first, «Остаться» keeps the call', async () => {
    const { api, onLeft, user } = setup({ organizer: true })
    await screen.findByText('Звук подключён')

    await user.click(screen.getByRole('button', { name: 'Выйти' }))
    const ask = screen.getByRole('dialog', { name: 'Комната закроется для всех участников' })
    expect(api.room.leave).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(within(ask).getByRole('button', { name: 'Остаться' }))

    await user.click(within(ask).getByRole('button', { name: 'Остаться' }))
    expect(screen.queryByRole('dialog', { name: /Комната закроется/ })).toBeNull()
    expect(onLeft).not.toHaveBeenCalled()
  })

  it('«Закрыть комнату» leaves and closes it', async () => {
    const { api, onLeft, user } = setup({ organizer: true })
    await screen.findByText('Звук подключён')
    await user.click(screen.getByRole('button', { name: 'Выйти' }))
    await user.click(screen.getByRole('button', { name: 'Закрыть комнату' }))
    expect(api.room.leave).toHaveBeenCalledOnce()
    expect(onLeft).toHaveBeenCalledOnce()
  })

  it('Esc keeps the call', async () => {
    const { user } = setup({ organizer: true })
    await screen.findByText('Звук подключён')
    await user.click(screen.getByRole('button', { name: 'Выйти' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: /Комната закроется/ })).toBeNull()
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

  it('answers Ctrl+Shift+M and Ctrl+Shift+D (#110), also on the Russian layout and while typing', async () => {
    const { setMuted, user } = setup()
    await screen.findByText('Звук подключён')

    // A single letter does nothing any more: too easy to press by accident.
    await user.keyboard('m')
    expect(setMuted).not.toHaveBeenCalled()
    await user.keyboard('{Control>}{Shift>}m{/Shift}{/Control}')
    expect(setMuted).toHaveBeenLastCalledWith(true)
    // The Russian layout: the same key types «Ь».
    fireEvent.keyDown(window, { key: 'Ь', code: 'KeyM', ctrlKey: true, shiftKey: true })
    expect(setMuted).toHaveBeenLastCalledWith(false)
    await user.keyboard('{Control>}{Shift>}d{/Shift}{/Control}')
    expect(sound().getAttribute('aria-pressed')).toBe('true')

    // With a modifier they work while typing too (the chat, as in Discord).
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    await user.keyboard('d')
    expect(sound().getAttribute('aria-pressed')).toBe('true')
    await user.keyboard('{Control>}{Shift>}d{/Shift}{/Control}')
    expect(sound().getAttribute('aria-pressed')).toBe('false')
    input.remove()
  })

  it('lists the keys by Ctrl+/ and puts them in the buttons’ tooltips (#110)', async () => {
    const { user } = setup()
    await screen.findByText('Звук подключён')
    fireEvent.keyDown(window, { key: '/', code: 'Slash', ctrlKey: true })
    const list = screen.getByRole('dialog', { name: 'Клавиши' })
    expect(within(list).getByText('Ctrl+Shift+M')).toBeTruthy()
    expect(within(list).getByText('Ctrl+Shift+D')).toBeTruthy()
    // jsdom has no Esc for <dialog>: the button does the same.
    await user.click(within(list).getByRole('button', { name: 'Закрыть' }))
    expect(screen.queryByRole('dialog', { name: 'Клавиши' })).toBeNull()

    await user.hover(screen.getByRole('button', { name: 'Выключить микрофон' }))
    expect((await screen.findByRole('tooltip', {}, { timeout: 2000 })).textContent).toBe(
      'Выключить микрофон · Ctrl+Shift+M',
    )
    expect(screen.queryByText(/— микрофон/)).toBeNull()
  })

  it('tells the organizer that leaving closes the room (#110)', async () => {
    const { user } = setup({ organizer: true })
    await screen.findByText('Звук подключён')

    await user.hover(screen.getByRole('button', { name: 'Выйти' }))
    expect((await screen.findByRole('tooltip', {}, { timeout: 2000 })).textContent).toBe(
      'Выйти и закрыть комнату',
    )
  })

  it('says once, in the first call, where the keys are (#110)', async () => {
    const { api, user } = setup({ keysHint: true })
    expect(await screen.findByText(/Клавиши звонка —/)).toBeTruthy()
    expect(api.settings.update).toHaveBeenCalledWith({ hints: { keys: true } })
    await user.click(screen.getByRole('button', { name: 'Понятно' }))
    expect(screen.queryByText(/Клавиши звонка —/)).toBeNull()
  })

  it('cannot unmute without a microphone', async () => {
    setup({ sending: false })
    await screen.findByText('Микрофон недоступен — только прослушивание')
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

describe('the own voice level (#110)', () => {
  const tip = () => screen.queryByText('Микрофон выключен — вас не слышно')

  it('grows a ring on the microphone button while the voice goes out', async () => {
    const { micLevel } = setup()
    await screen.findByText('Звук подключён')
    const button = screen.getByRole('button', { name: 'Выключить микрофон' })

    micLevel(0.62)
    expect(button.style.getPropertyValue('--mic-level')).toBe('0.6')

    // Muted, nothing goes out: no ring.
    await userEvent.setup().click(button)
    expect(button.style.getPropertyValue('--mic-level')).toBe('0')
  })

  it('says once per call that the microphone is off when they speak muted', async () => {
    const now = vi.spyOn(performance, 'now')
    const { micLevel, user, setMuted } = setup({ muted: true })
    await screen.findByText('Звук подключён')

    now.mockReturnValue(1000)
    micLevel(MUTED_SPEECH_LEVEL + 0.1)
    now.mockReturnValue(1000 + MUTED_SPEECH_MS - 1)
    micLevel(MUTED_SPEECH_LEVEL + 0.1)
    expect(tip()).toBeNull()
    now.mockReturnValue(1000 + MUTED_SPEECH_MS)
    micLevel(MUTED_SPEECH_LEVEL + 0.1)
    expect(tip()).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'Включить' }))
    expect(setMuted).toHaveBeenLastCalledWith(false)
    expect(tip()).toBeNull()

    // Muted again and speaking: not repeated.
    await user.click(screen.getByRole('button', { name: 'Выключить микрофон' }))
    now.mockReturnValue(5000)
    micLevel(1)
    now.mockReturnValue(5000 + MUTED_SPEECH_MS * 2)
    micLevel(1)
    expect(tip()).toBeNull()
    now.mockRestore()
  })

  it('stays quiet for a short sound', async () => {
    const now = vi.spyOn(performance, 'now')
    const { micLevel } = setup({ muted: true })
    await screen.findByText('Звук подключён')

    now.mockReturnValue(1000)
    micLevel(0.9)
    now.mockReturnValue(1200)
    micLevel(0.05)
    now.mockReturnValue(1000 + MUTED_SPEECH_MS * 2)
    micLevel(0.9)
    expect(tip()).toBeNull()
    now.mockRestore()
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
      expect(labels()).toEqual(['Дима, громкость 150 %', 'Алексей (я)'])
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
    const menu = screen.getByRole('dialog', { name: 'Мой звук' })
    await user.click(within(menu).getByRole('button', { name: 'Настройки' }))
    expect(screen.getByRole('dialog', { name: 'Настройки' })).toBeTruthy()
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
    expect(labels()).toEqual(['Дима, микрофон выключен', 'Алексей (я)'])
  })
})

describe('«Настройки» during a call (#24)', () => {
  async function openSettings() {
    const ctx = setup()
    await screen.findByText('Звук подключён')
    await ctx.user.click(screen.getByRole('button', { name: 'Настройки' }))
    const dialog = screen.getByRole('dialog', { name: 'Настройки' })
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

    await user.keyboard('{Control>}{Shift>}m{/Shift}{/Control}')
    expect(setMuted).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Закрыть' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await user.keyboard('{Control>}{Shift>}m{/Shift}{/Control}')
    expect(setMuted).toHaveBeenCalledWith(true)
  })
})

describe('showing your screen: picking the source (#26)', () => {
  async function openPicker() {
    const ctx = setup()
    await screen.findByText('Звук подключён')
    await ctx.user.click(screen.getByRole('button', { name: 'Показать экран' }))
    const dialog = screen.getByRole('dialog', { name: 'Что показать' })
    return { ...ctx, dialog }
  }

  it('lists screens and windows on tabs, and shows the picked one', async () => {
    const { screen: capture, dialog, user, startScreen: startScreenSpy } = await openPicker()
    const show = within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Показать' })

    expect(await within(dialog).findByRole('radio', { name: 'Экран 1' })).toBeTruthy()
    expect(
      within(within(dialog).getByRole('radiogroup', { name: 'Экраны' })).getAllByRole('radio'),
    ).toHaveLength(2)
    expect(show.disabled).toBe(true)
    await user.click(within(dialog).getByRole('tab', { name: /Окна/ }))
    await user.click(within(dialog).getByRole('radio', { name: 'Редактор' }))
    expect(
      within(dialog).getByRole('radio', { name: 'Редактор' }).getAttribute('aria-checked'),
    ).toBe('true')
    await user.click(show)

    expect(capture.access.capture).toHaveBeenCalledWith('window:42:0', false)
    expect(screen.queryByRole('dialog')).toBeNull()
    // Sent to everyone in the room's mode (#27).
    await vi.waitFor(() => {
      expect(startScreenSpy).toHaveBeenCalledWith(expect.anything(), 'auto', null)
    })
    expect(await screen.findByRole('region', { name: 'Мой экран' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Остановить показ экрана' })).toBeTruthy()
  })

  it('offers «Звук компьютера» where it works and sends it with the screen (#41)', async () => {
    const ctx = setup({ screenSources: { ...SCREENS, systemAudio: true } })
    await screen.findByText('Звук подключён')
    await ctx.user.click(screen.getByRole('button', { name: 'Показать экран' }))
    const dialog = screen.getByRole('dialog', { name: 'Что показать' })
    const sound = await within(dialog).findByRole<HTMLInputElement>('checkbox', {
      name: 'Звук компьютера',
    })
    // Off at first, as in Zoom.
    expect(sound.checked).toBe(false)
    await ctx.user.click(sound)
    await ctx.user.click(within(dialog).getByRole('radio', { name: 'Экран 1' }))
    await ctx.user.click(within(dialog).getByRole('button', { name: 'Показать' }))

    expect(ctx.screen.access.capture).toHaveBeenCalledWith('screen:1:0', true)
    await vi.waitFor(() => {
      expect(ctx.startScreen).toHaveBeenCalledWith(expect.anything(), 'auto', ctx.screen.sound)
    })
  })

  it('does not offer the computer’s sound where it does not work', async () => {
    const { dialog } = await openPicker()
    await within(dialog).findByRole('radio', { name: 'Экран 1' })
    expect(within(dialog).queryByRole('checkbox', { name: 'Звук компьютера' })).toBeNull()
  })

  it('stops showing from the button or when the system ends it', async () => {
    const { screen: capture, dialog, user, stopScreen: stopScreenSpy } = await openPicker()
    await user.click(await within(dialog).findByRole('radio', { name: 'Экран 1' }))
    await user.click(within(dialog).getByRole('button', { name: 'Показать' }))
    await screen.findByRole('region', { name: 'Мой экран' })

    await user.click(screen.getByRole('button', { name: 'Остановить показ экрана' }))
    expect(capture.stop).toHaveBeenCalled()
    expect(stopScreenSpy).toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'Мой экран' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Показать экран' }))
    const again = screen.getByRole('dialog', { name: 'Что показать' })
    await user.dblClick(await within(again).findByRole('radio', { name: 'Экран 2' }))
    await screen.findByRole('region', { name: 'Мой экран' })
    capture.end()
    await vi.waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Мой экран' })).toBeNull()
    })
  })

  it('refreshes the list on request', async () => {
    const { screen: capture, dialog, user } = await openPicker()
    await within(dialog).findByRole('radio', { name: 'Экран 1' })

    await user.click(within(dialog).getByRole('button', { name: 'Обновить список' }))

    await vi.waitFor(() => {
      expect(capture.access.listSources).toHaveBeenCalledTimes(2)
    })
  })

  it('explains the missing permission on macOS', async () => {
    const ctx = setup({ screenSources: { picker: 'denied' } })
    await screen.findByText('Звук подключён')
    await ctx.user.click(screen.getByRole('button', { name: 'Показать экран' }))

    expect(await screen.findByText(/Нет разрешения на запись экрана/)).toBeTruthy()
    await ctx.user.click(screen.getByRole('button', { name: 'Открыть настройки' }))
    expect(ctx.screen.access.openPermissionSettings).toHaveBeenCalled()
  })

  it('says why before macOS asks for «Запись экрана» the first time (#85)', async () => {
    const ctx = setup({ screenPermission: 'not-asked' })
    await screen.findByText('Звук подключён')
    await ctx.user.click(screen.getByRole('button', { name: 'Показать экран' }))

    expect(await screen.findByText(/macOS попросит разрешение «Запись экрана»/)).toBeTruthy()
    expect(ctx.screen.access.listSources).not.toHaveBeenCalled()
    await ctx.user.click(screen.getByRole('button', { name: 'Продолжить' }))
    const dialog = screen.getByRole('dialog', { name: 'Что показать' })
    expect(await within(dialog).findByRole('radio', { name: 'Экран 1' })).toBeTruthy()
  })

  it('offers a restart once «Запись экрана» waits for one (#85)', async () => {
    const ctx = setup({ screenSources: { picker: 'restart' } })
    await screen.findByText('Звук подключён')
    await ctx.user.click(screen.getByRole('button', { name: 'Показать экран' }))

    expect(await screen.findByText(/заработает после перезапуска Tolki/)).toBeTruthy()
    expect(screen.getByText('Перезапуск завершит звонок.')).toBeTruthy()
    await ctx.user.click(screen.getByRole('button', { name: 'Перезапустить Tolki' }))
    expect(ctx.screen.access.relaunch).toHaveBeenCalledOnce()
  })

  it('asks again after the settings, so the restart shows up (#85)', async () => {
    const ctx = setup({ screenSources: { picker: 'denied' } })
    await screen.findByText('Звук подключён')
    await ctx.user.click(screen.getByRole('button', { name: 'Показать экран' }))
    await ctx.user.click(await screen.findByRole('button', { name: 'Открыть настройки' }))
    await vi.waitFor(() => {
      expect(ctx.screen.access.listSources).toHaveBeenCalledTimes(2)
    })
  })

  it('listening only because the OS denies the microphone: its settings open (#85)', async () => {
    const ctx = setup({ sending: false, permissions: { microphone: 'denied' } })
    expect(await screen.findByText('Нет доступа к микрофону — только прослушивание')).toBeTruthy()
    await ctx.user.click(screen.getByRole('button', { name: 'Открыть настройки' }))
    expect(ctx.api.permissions.openSettings).toHaveBeenCalledWith('microphone')
  })

  it('a missing microphone is not a permission matter', async () => {
    setup({ sending: false })
    expect(await screen.findByText('Микрофон недоступен — только прослушивание')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Открыть настройки' })).toBeNull()
  })

  it('the sharer picks what is shown; the room’s mode first, then the last pick (#86)', async () => {
    const ctx = setup({ roomScreenMode: 'text' })
    await screen.findByText('Звук подключён')
    await ctx.user.click(screen.getByRole('button', { name: 'Показать экран' }))
    const dialog = screen.getByRole('dialog', { name: 'Что показать' })
    const modes = within(dialog).getByRole('group', { name: 'Что показываете' })
    expect(
      within(modes).getByRole<HTMLInputElement>('radio', { name: /Чёткий текст/ }).checked,
    ).toBe(true)
    await ctx.user.click(within(modes).getByRole('radio', { name: /Плавно/ }))
    await ctx.user.click(await within(dialog).findByRole('radio', { name: 'Экран 1' }))
    await ctx.user.click(within(dialog).getByRole('button', { name: 'Показать' }))
    await vi.waitFor(() => {
      expect(ctx.startScreen).toHaveBeenCalledWith(expect.anything(), 'motion', null)
    })
    expect(ctx.api.settings.update).toHaveBeenCalledWith({ screen: { mode: 'motion' } })
  })

  it('opens with the remembered pick (#86)', async () => {
    const ctx = setup({ roomScreenMode: 'text', screenMode: 'motion' })
    await screen.findByText('Звук подключён')
    await vi.waitFor(() => {
      expect(ctx.api.settings.get).toHaveBeenCalled()
    })
    await ctx.user.click(screen.getByRole('button', { name: 'Показать экран' }))
    const modes = within(screen.getByRole('dialog', { name: 'Что показать' })).getByRole('group', {
      name: 'Что показываете',
    })
    expect(within(modes).getByRole<HTMLInputElement>('radio', { name: /Плавно/ }).checked).toBe(
      true,
    )
  })

  it('passes the organizer’s ceiling on to the screen being sent (#86)', async () => {
    const ctx = setup()
    await screen.findByText('Звук подключён')
    ctx.api.room.emitEvent({ type: 'screen-budget', height: 720, maxBitrate: 1_500_000 })
    expect(ctx.setScreenBudget).toHaveBeenCalledWith({ height: 720, maxBitrate: 1_500_000 })
  })

  it('stops searching after a while and offers to try again (#123)', async () => {
    const ctx = setup()
    await screen.findByText('Звук подключён')
    ctx.screen.access.listSources.mockReturnValueOnce(new Promise(() => undefined))
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      await ctx.user.click(screen.getByRole('button', { name: 'Показать экран' }))
      expect(screen.getByText('Поиск экранов и окон…')).toBeTruthy()
      await vi.advanceTimersByTimeAsync(LIST_TIMEOUT_MS)
      expect(await screen.findByText('Список экранов получить не удалось.')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
    await ctx.user.click(screen.getByRole('button', { name: 'Попробовать снова' }))
    const dialog = screen.getByRole('dialog', { name: 'Что показать' })
    expect(await within(dialog).findByRole('radio', { name: 'Экран 1' })).toBeTruthy()
  })

  it('lets the system pick on Wayland', async () => {
    const ctx = setup({ screenSources: { picker: 'system' } })
    await screen.findByText('Звук подключён')
    await ctx.user.click(screen.getByRole('button', { name: 'Показать экран' }))

    await ctx.user.click(await screen.findByRole('button', { name: 'Выбрать экран' }))
    expect(ctx.screen.access.capture).toHaveBeenCalledWith(null, false)
  })

  it('stays quiet when the user cancels, and says so when capture fails', async () => {
    const ctx = setup()
    await screen.findByText('Звук подключён')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const pickFirst = async () => {
      await ctx.user.click(screen.getByRole('button', { name: 'Показать экран' }))
      const dialog = screen.getByRole('dialog', { name: 'Что показать' })
      await ctx.user.click(await within(dialog).findByRole('radio', { name: 'Экран 1' }))
      await ctx.user.click(within(dialog).getByRole('button', { name: 'Показать' }))
    }

    ctx.screen.access.capture.mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'))
    await pickFirst()
    expect(screen.queryByRole('alert')).toBeNull()

    ctx.screen.access.capture.mockRejectedValueOnce(new Error('boom'))
    await pickFirst()
    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})

describe('others’ screens in the call (#28)', () => {
  it('shows a screen someone shares, named after them, and drops it when they stop', async () => {
    vi.stubGlobal('MediaStream', vi.fn())
    const ctx = setup()
    await screen.findByText('Звук подключён')

    ctx.showScreens([{ consumerId: 'c1', peerId: 'dima', track: {} as MediaStreamTrack }])
    expect(await screen.findByRole('region', { name: 'Экран: Дима' })).toBeTruthy()

    ctx.showScreens([])
    expect(screen.queryByRole('region', { name: 'Экран: Дима' })).toBeNull()
    vi.unstubAllGlobals()
  })
})

describe('one screen at a time: «Показать свой» (#29)', () => {
  const button = (name: string | RegExp) => screen.getByRole('button', { name })

  it('asks the sharer, waits, and opens the picker when they give way', async () => {
    const ctx = setup({ sharerId: 'dima' })
    await screen.findByText('Звук подключён')

    await ctx.user.click(button('Попросить показать свой экран'))
    expect(ctx.requestScreen).toHaveBeenCalledOnce()
    expect(button('Ожидание ответа на запрос показа')).toHaveProperty('disabled', true)

    ctx.api.room.emitEvent({ type: 'screen-request-answer', accepted: true })
    expect(await screen.findByRole('dialog', { name: 'Что показать' })).toBeTruthy()
  })

  it('says so when the sharer keeps showing', async () => {
    const ctx = setup({ sharerId: 'dima' })
    await screen.findByText('Звук подключён')
    await ctx.user.click(button('Попросить показать свой экран'))

    ctx.api.room.emitEvent({ type: 'screen-request-answer', accepted: false })

    expect(await screen.findByText('Дима продолжает показ')).toBeTruthy()
    expect(button('Попросить показать свой экран')).toHaveProperty('disabled', false)
  })

  it('opens the picker if the sharer simply stops while the user waits', async () => {
    const ctx = setup({ sharerId: 'dima' })
    await screen.findByText('Звук подключён')
    await ctx.user.click(button('Попросить показать свой экран'))

    ctx.api.room.emitEvent({ type: 'screen-share-stopped', peerId: 'dima' })

    expect(await screen.findByRole('dialog', { name: 'Что показать' })).toBeTruthy()
    expect(button('Показать экран')).toBeTruthy()
  })

  it('follows who shares', async () => {
    const ctx = setup()
    await screen.findByText('Звук подключён')
    expect(button('Показать экран')).toBeTruthy()
    ctx.api.room.emitEvent({ type: 'screen-share-started', peerId: 'dima' })
    expect(button('Попросить показать свой экран')).toBeTruthy()
  })

  it('lets the sharer give way or keep showing', async () => {
    const ctx = setup()
    await screen.findByText('Звук подключён')
    await ctx.user.click(button('Показать экран'))
    const dialog = screen.getByRole('dialog', { name: 'Что показать' })
    await ctx.user.click(await within(dialog).findByRole('radio', { name: 'Экран 1' }))
    await ctx.user.click(within(dialog).getByRole('button', { name: 'Показать' }))
    await screen.findByRole('region', { name: 'Мой экран' })

    ctx.api.room.emitEvent({ type: 'screen-request', fromPeerId: 'dima' })
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Дима просит показать свой экран',
    )
    await ctx.user.click(button('Продолжить показ'))
    expect(ctx.answerScreenRequest).toHaveBeenLastCalledWith('dima', false)
    expect(screen.getByRole('region', { name: 'Мой экран' })).toBeTruthy()

    ctx.api.room.emitEvent({ type: 'screen-request', fromPeerId: 'dima' })
    await ctx.user.click(await screen.findByRole('button', { name: 'Уступить' }))
    expect(ctx.answerScreenRequest).toHaveBeenLastCalledWith('dima', true)
    await vi.waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Мой экран' })).toBeNull()
    })
    expect(ctx.stopScreen).toHaveBeenCalled()
  })

  it('stops the capture when someone else got the screen first', async () => {
    const ctx = setup()
    await screen.findByText('Звук подключён')
    ctx.startScreen.mockRejectedValueOnce(new Error('produce: SCREEN_BUSY'))
    ctx.api.room.emitEvent({ type: 'screen-share-started', peerId: 'dima' })
    ctx.api.room.emitEvent({ type: 'screen-share-stopped', peerId: 'dima' })
    await ctx.user.click(button('Показать экран'))
    const dialog = screen.getByRole('dialog', { name: 'Что показать' })
    await ctx.user.click(await within(dialog).findByRole('radio', { name: 'Экран 1' }))
    await ctx.user.click(within(dialog).getByRole('button', { name: 'Показать' }))

    expect(await screen.findByText(/Сейчас показывает/)).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Мой экран' })).toBeNull()
    expect(ctx.screen.stop).toHaveBeenCalled()
  })
})

describe('the screen stage (#30)', () => {
  async function withRemoteScreen() {
    vi.stubGlobal('MediaStream', vi.fn())
    const ctx = setup()
    await screen.findByText('Звук подключён')
    ctx.showScreens([{ consumerId: 'c1', peerId: 'dima', track: {} as MediaStreamTrack }])
    await screen.findByRole('region', { name: 'Экран: Дима' })
    return ctx
  }
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hides the header, the bar and the strip after 3 s without a mouse move (#149)', async () => {
    await withRemoteScreen()
    const call = document.querySelector('main.call')
    if (!call) throw new Error('no call')
    vi.useFakeTimers()
    fireEvent.pointerMove(call)
    vi.advanceTimersByTime(CHROME_HIDE_MS - 1)
    expect(call.classList.contains('call--chrome-hidden')).toBe(false)
    vi.advanceTimersByTime(1)
    expect(call.classList.contains('call--chrome-hidden')).toBe(true)

    fireEvent.pointerMove(call)
    expect(call.classList.contains('call--chrome-hidden')).toBe(false)
    vi.useRealTimers()
  })

  it('keeps the chrome over the tiles', async () => {
    setup()
    await screen.findByText('Звук подключён')
    const call = document.querySelector('main.call')
    vi.useFakeTimers()
    if (call) fireEvent.pointerMove(call)
    vi.advanceTimersByTime(CHROME_HIDE_MS * 2)
    expect(call?.classList.contains('call--chrome-hidden')).toBe(false)
    vi.useRealTimers()
  })

  it('opens on the shared screen with people in a strip under it', async () => {
    await withRemoteScreen()

    const strip = screen.getByRole('list', { name: 'Участники' })
    expect(
      within(strip)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['ДДима', 'ААлексейя'])
    expect(screen.queryByRole('button', { name: 'Меню: Дима' })).toBeNull()
  })

  it('goes to all participants and back; the hidden screen is paused', async () => {
    const ctx = await withRemoteScreen()

    await ctx.user.click(screen.getByRole('button', { name: 'Все участники' }))

    expect(screen.queryByRole('region', { name: 'Экран: Дима' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Меню: Дима' })).toBeTruthy()
    expect(ctx.setScreenVisible).toHaveBeenLastCalledWith('c1', false)
    await ctx.user.click(screen.getByRole('button', { name: 'Смотреть' }))
    expect(screen.getByRole('region', { name: 'Экран: Дима' })).toBeTruthy()
  })

  it('stays on the tiles when people come and go, returns to the stage for a new share', async () => {
    const ctx = await withRemoteScreen()
    await ctx.user.click(screen.getByRole('button', { name: 'Все участники' }))

    ctx.api.room.emitEvent({ type: 'peer-joined', peer: { id: 'katya', name: 'Катя' } })
    expect(screen.queryByRole('region', { name: 'Экран: Дима' })).toBeNull()

    ctx.showScreens([{ consumerId: 'c2', peerId: 'katya', track: {} as MediaStreamTrack }])
    expect(await screen.findByRole('region', { name: 'Экран: Катя' })).toBeTruthy()
  })

  it('shows the other stream when the host switches, staying where the user is (#34)', async () => {
    const ctx = await withRemoteScreen()
    const video = (): HTMLVideoElement | null => document.querySelector('.screen-stage-video')
    const before = video()?.srcObject
    const low = {} as MediaStreamTrack

    ctx.showScreens([{ consumerId: 'c1', peerId: 'dima', track: low }])

    expect(screen.getByRole('region', { name: 'Экран: Дима' })).toBeTruthy()
    expect(video()?.srcObject).not.toBe(before)
    expect(vi.mocked(MediaStream)).toHaveBeenLastCalledWith([low])
    // The stage stays the same screen: no «hidden» for it in between.
    expect(ctx.setScreenVisible).not.toHaveBeenCalledWith('c1', false)
  })

  it('goes back to the tiles when sharing ends', async () => {
    const ctx = await withRemoteScreen()
    ctx.showScreens([])
    expect(screen.queryByRole('region')).toBeNull()
    expect(screen.getByRole('button', { name: 'Меню: Дима' })).toBeTruthy()
  })
})

describe('reconnecting (#31)', () => {
  it('shows «Переподключение…» and starts the call over when back', async () => {
    const ctx = setup()
    await screen.findByText('Звук подключён')

    ctx.api.room.emitEvent({ type: 'active-speakers', peerIds: ['dima'] })
    ctx.api.room.emitReconnecting()
    expect(screen.getByText('Переподключение…')).toBeTruthy()
    // Nothing is heard meanwhile: no «Звук подключён», no speaking frame.
    expect(screen.getByText('Звук подключён').closest('p')?.hidden).toBe(true)
    expect(document.querySelector('.call-tile--speaking')).toBeNull()

    ctx.api.room.emitReconnected({
      ...RESULT,
      peerId: 'me-again',
      peers: [{ id: 'katya', name: 'Катя' }],
      routerRtpCapabilities: { codecs: [] },
      mutedPeers: [],
      sharerId: null,
    })

    await screen.findByText('Звук подключён')
    expect(screen.queryByText('Переподключение…')).toBeNull()
    expect(ctx.close).toHaveBeenCalledOnce()
    expect(ctx.labels()).toEqual(['Катя', 'Алексей (я)'])
  })

  it('sends the screen again after reconnecting', async () => {
    const ctx = setup()
    await screen.findByText('Звук подключён')
    await ctx.user.click(screen.getByRole('button', { name: 'Показать экран' }))
    const dialog = screen.getByRole('dialog', { name: 'Что показать' })
    await ctx.user.click(await within(dialog).findByRole('radio', { name: 'Экран 1' }))
    await ctx.user.click(within(dialog).getByRole('button', { name: 'Показать' }))
    await vi.waitFor(() => {
      expect(ctx.startScreen).toHaveBeenCalledOnce()
    })

    ctx.api.room.emitReconnected({ ...RESULT, peerId: 'me-again', mutedPeers: [], sharerId: null })

    await vi.waitFor(() => {
      expect(ctx.startScreen).toHaveBeenCalledTimes(2)
    })
  })
})

describe('connection indicator in the header (#32)', () => {
  it('shows how the link to the organizer is', async () => {
    setup()
    expect(await screen.findByText('24 мс · через организатора (UDP)')).toBeTruthy()
  })
})

describe('push-to-talk (#39)', () => {
  const PTT = { enabled: true, key: 'KeyV' }

  it('talks only while the key is held, and says which key', async () => {
    const ctx = setup({ pushToTalk: PTT })
    await screen.findByText('Звук подключён')
    await vi.waitFor(() => {
      expect(ctx.api.ptt.configure).toHaveBeenLastCalledWith({
        active: true,
        key: 'KeyV',
        askPermission: false,
      })
    })
    expect(ctx.setTransmitting).toHaveBeenLastCalledWith(false)
    expect(screen.getByRole('button', { name: 'Микрофон по клавише V' })).toHaveProperty(
      'disabled',
      true,
    )
    // The list of keys names it (#110).
    fireEvent.keyDown(window, { key: '/', code: 'Slash', ctrlKey: true })
    expect(
      within(screen.getByRole('dialog', { name: 'Клавиши' })).getByText('Говорить, пока нажата'),
    ).toBeTruthy()
    fireEvent.keyDown(window, { key: '/', code: 'Slash', ctrlKey: true })

    // The global hook in main sees the key, wherever the focus is.
    ctx.api.ptt.emitKey(true)
    expect(ctx.setTransmitting).toHaveBeenLastCalledWith(true)
    expect(screen.getByRole('button', { name: 'Микрофон по клавише V' }).textContent).toContain(
      'Говорите',
    )
    ctx.api.ptt.emitKey(false)
    expect(ctx.setTransmitting).toHaveBeenLastCalledWith(false)
  })

  it('works in the window when there is no global hook, and lets go when the window does', async () => {
    const ctx = setup({ pushToTalk: PTT, pushToTalkMode: 'focus' })
    await screen.findByText('Звук подключён')
    await vi.waitFor(() => {
      expect(ctx.api.ptt.configure).toHaveBeenCalled()
    })

    await ctx.user.keyboard('{v>}')
    expect(ctx.setTransmitting).toHaveBeenLastCalledWith(true)
    await ctx.user.keyboard('{/v}')
    expect(ctx.setTransmitting).toHaveBeenLastCalledWith(false)

    await ctx.user.keyboard('{v>}')
    window.dispatchEvent(new Event('blur'))
    expect(ctx.setTransmitting).toHaveBeenLastCalledWith(false)
  })

  it('stays silent with the key held while deafened, and M does nothing', async () => {
    const ctx = setup({ pushToTalk: PTT })
    await screen.findByText('Звук подключён')
    await vi.waitFor(() => {
      expect(ctx.api.ptt.configure).toHaveBeenCalled()
    })
    ctx.setMuted.mockClear()

    await ctx.user.keyboard('{Control>}{Shift>}m{/Shift}{/Control}')
    expect(ctx.setMuted).not.toHaveBeenCalled()

    await ctx.user.keyboard('{Control>}{Shift>}d{/Shift}{/Control}')
    ctx.api.ptt.emitKey(true)
    expect(ctx.setTransmitting).toHaveBeenLastCalledWith(false)
  })

  it('opens the microphone at the host when turned on after joining muted', async () => {
    const ctx = setup({ muted: true, pushToTalk: PTT })
    await screen.findByText('Звук подключён')
    await vi.waitFor(() => {
      expect(ctx.setMuted).toHaveBeenLastCalledWith(false)
    })
    expect(ctx.setTransmitting).toHaveBeenLastCalledWith(false)
  })

  it('turns on from «Настройки», asking macOS for its permission, and picks a key', async () => {
    const ctx = setup({ pushToTalkMode: 'needs-permission' })
    await screen.findByText('Звук подключён')
    await ctx.user.click(screen.getByRole('button', { name: 'Настройки' }))
    const dialog = screen.getByRole('dialog', { name: 'Настройки' })

    await ctx.user.click(
      within(dialog).getByRole('checkbox', { name: 'Говорить, только пока нажата клавиша' }),
    )
    expect(ctx.api.settings.update).toHaveBeenCalledWith({
      pushToTalk: { enabled: true, key: 'Backquote' },
    })
    expect(ctx.api.ptt.configure).toHaveBeenLastCalledWith({
      active: true,
      key: 'Backquote',
      askPermission: true,
    })
    expect(await within(dialog).findByText(/Универсальный доступ/)).toBeTruthy()
    await ctx.user.click(within(dialog).getByRole('button', { name: 'Открыть настройки' }))
    expect(ctx.api.ptt.openPermissionSettings).toHaveBeenCalled()

    await ctx.user.click(
      within(dialog).getByRole('button', { name: 'Клавиша для разговора: Ё (`)' }),
    )
    expect(within(dialog).getByText('Нажмите клавишу…')).toBeTruthy()
    await ctx.user.keyboard('[KeyB]')
    expect(ctx.api.settings.update).toHaveBeenLastCalledWith({
      pushToTalk: { enabled: true, key: 'KeyB' },
    })
    expect(within(dialog).getByRole('button', { name: 'Клавиша для разговора: B' })).toBeTruthy()
  })

  it('stops the global hook when the call ends', async () => {
    const ctx = setup({ pushToTalk: PTT })
    await screen.findByText('Звук подключён')
    await ctx.user.click(screen.getByRole('button', { name: 'Выйти' }))
    expect(ctx.api.ptt.configure).toHaveBeenLastCalledWith(
      expect.objectContaining({ active: false }),
    )
  })
})

describe('global hotkeys (#40)', () => {
  it('registers the saved hotkeys for the call and acts on them like M and D', async () => {
    const ctx = setup({ globalHotkeys: { mute: 'Control+Shift+M', deafen: 'Control+Shift+D' } })
    await screen.findByText('Звук подключён')
    await vi.waitFor(() => {
      expect(ctx.api.hotkeys.configure).toHaveBeenLastCalledWith({
        active: true,
        mute: 'Control+Shift+M',
        deafen: 'Control+Shift+D',
      })
    })

    ctx.api.hotkeys.emitPressed('mute')
    expect(ctx.setMuted).toHaveBeenLastCalledWith(true)
    expect(screen.getByRole('button', { name: 'Включить микрофон' })).toBeTruthy()
    ctx.api.hotkeys.emitPressed('deafen')
    expect(screen.getByRole('button', { name: 'Включить звук' })).toBeTruthy()
  })

  it('registers nothing when none are set, and lets go of them when the call ends', async () => {
    const quiet = setup()
    await screen.findByText('Звук подключён')
    expect(quiet.api.hotkeys.configure).not.toHaveBeenCalled()
    cleanup()

    const ctx = setup({ globalHotkeys: { mute: 'Alt+M', deafen: '' } })
    await screen.findByText('Звук подключён')
    await ctx.user.click(screen.getByRole('button', { name: 'Выйти' }))
    expect(ctx.api.hotkeys.configure).toHaveBeenLastCalledWith({
      active: false,
      mute: '',
      deafen: '',
    })
  })

  it('sets a combination in «Настройки», steps the others aside meanwhile, and clears it', async () => {
    const ctx = setup({ globalHotkeys: { mute: '', deafen: 'Alt+F9' } })
    await screen.findByText('Звук подключён')
    await ctx.user.click(screen.getByRole('button', { name: 'Настройки' }))
    const dialog = screen.getByRole('dialog', { name: 'Настройки' })

    await ctx.user.click(within(dialog).getByRole('button', { name: 'Микрофон: не задано' }))
    expect(ctx.api.hotkeys.configure).toHaveBeenLastCalledWith(
      expect.objectContaining({ active: false }),
    )
    // A plain letter would fire while typing elsewhere.
    await ctx.user.keyboard('m')
    expect(within(dialog).getByText(/Нужно сочетание с Ctrl, Alt или Cmd/)).toBeTruthy()
    await ctx.user.keyboard('{Control>}{Shift>}m{/Shift}{/Control}')
    expect(ctx.api.settings.update).toHaveBeenLastCalledWith({
      globalHotkeys: { mute: 'Control+Shift+M' },
    })
    expect(ctx.api.hotkeys.configure).toHaveBeenLastCalledWith({
      active: true,
      mute: 'Control+Shift+M',
      deafen: 'Alt+F9',
    })
    expect(within(dialog).getByRole('button', { name: 'Микрофон: Ctrl+Shift+M' })).toBeTruthy()

    await ctx.user.click(within(dialog).getByRole('button', { name: 'Убрать: звук' }))
    expect(ctx.api.settings.update).toHaveBeenLastCalledWith({ globalHotkeys: { deafen: '' } })
    expect(within(dialog).getByRole('button', { name: 'Звук: не задано' })).toBeTruthy()
  })

  it('says when another app holds the combination', async () => {
    const ctx = setup({
      globalHotkeys: { mute: 'Control+Shift+M', deafen: '' },
      takenHotkeys: ['Control+Shift+M'],
    })
    await screen.findByText('Звук подключён')
    await ctx.user.click(screen.getByRole('button', { name: 'Настройки' }))
    expect(
      await screen.findByText('Это сочетание занято другим приложением — нужно другое.'),
    ).toBeTruthy()
  })
})

describe('the organizer’s rights (#42)', () => {
  it('lets people in or not, one card each', async () => {
    const ctx = setup({ organizer: true, approval: true })
    await screen.findByText('Звук подключён')
    ctx.api.room.emitEvent({ type: 'join-request', requestId: 'r1', name: 'Катя' })
    ctx.api.room.emitEvent({ type: 'join-request', requestId: 'r2', name: 'Миша' })
    expect(await screen.findByText('Катя просит впустить')).toBeTruthy()
    expect(screen.getByText('Миша просит впустить')).toBeTruthy()

    const katya = screen.getByText('Катя просит впустить').closest('.call-request') as HTMLElement
    await ctx.user.click(within(katya).getByRole('button', { name: 'Впустить' }))
    expect(ctx.api.room.request).toHaveBeenCalledWith({
      method: 'answerJoin',
      requestId: 'r1',
      admit: true,
    })
    expect(screen.queryByText('Катя просит впустить')).toBeNull()

    // Misha gave up waiting.
    ctx.api.room.emitEvent({ type: 'join-request-gone', requestId: 'r2' })
    expect(screen.queryByText('Миша просит впустить')).toBeNull()
  })

  it('turns entry by approval on and off from the room menu (#110)', async () => {
    const ctx = setup({ organizer: true })
    await screen.findByText('Звук подключён')
    await ctx.user.click(screen.getByRole('button', { name: 'Меню комнаты' }))
    const menu = screen.getByRole('dialog', { name: 'Комната' })
    const approval = within(menu).getByRole('checkbox', { name: 'Подтверждать вход' })
    expect(approval).toHaveProperty('checked', false)
    await ctx.user.click(approval)
    expect(ctx.api.room.request).toHaveBeenCalledWith({ method: 'setApproval', enabled: true })
    expect(approval).toHaveProperty('checked', true)
    await ctx.user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Комната' })).toBeNull()
  })

  it('removes someone from their tile, asking once more', async () => {
    const ctx = setup({ organizer: true })
    await screen.findByText('Звук подключён')
    await ctx.user.click(screen.getByRole('button', { name: 'Меню: Дима' }))
    const menu = screen.getByRole('dialog', { name: 'Звук: Дима' })
    await ctx.user.click(within(menu).getByRole('button', { name: 'Удалить из комнаты' }))
    expect(within(menu).getByText(/Дима отключится/)).toBeTruthy()
    await ctx.user.click(within(menu).getByRole('button', { name: 'Удалить' }))
    expect(ctx.api.room.request).toHaveBeenCalledWith({ method: 'removePeer', peerId: 'dima' })
  })

  it('offers none of it to other participants', async () => {
    const ctx = setup()
    await screen.findByText('Звук подключён')
    expect(screen.queryByRole('button', { name: 'Меню комнаты' })).toBeNull()
    await ctx.user.click(screen.getByRole('button', { name: 'Меню: Дима' }))
    expect(screen.queryByRole('button', { name: 'Удалить из комнаты' })).toBeNull()
  })
})

describe('cues when people come and go (#43)', () => {
  it('chimes for someone coming and leaving, on the chosen output', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const ctx = setup()
    await screen.findByText('Звук подключён')
    ctx.api.room.emitEvent({ type: 'peer-joined', peer: { id: 'katya', name: 'Катя' } })
    expect(ctx.playCue).toHaveBeenLastCalledWith('join', '')
    vi.setSystemTime(Date.now() + 1000)
    ctx.api.room.emitEvent({ type: 'peer-left', peerId: 'katya' })
    expect(ctx.playCue).toHaveBeenLastCalledWith('leave', '')
    vi.useRealTimers()
  })

  it('stays quiet while the sound is off, and when cues are turned off in the settings', async () => {
    const ctx = setup()
    await screen.findByText('Звук подключён')
    await ctx.user.keyboard('{Control>}{Shift>}d{/Shift}{/Control}')
    ctx.api.room.emitEvent({ type: 'peer-joined', peer: { id: 'katya', name: 'Катя' } })
    expect(ctx.playCue).not.toHaveBeenCalled()
    await ctx.user.keyboard('{Control>}{Shift>}d{/Shift}{/Control}')

    await ctx.user.click(screen.getByRole('button', { name: 'Настройки' }))
    const dialog = screen.getByRole('dialog', { name: 'Настройки' })
    await ctx.user.click(within(dialog).getByRole('checkbox', { name: 'Звуки входа и выхода' }))
    expect(ctx.api.settings.update).toHaveBeenLastCalledWith({ sounds: { enabled: false } })
    ctx.api.room.emitEvent({ type: 'peer-left', peerId: 'katya' })
    expect(ctx.playCue).not.toHaveBeenCalled()
  })

  it('knocks for the organizer when someone asks to be let in', async () => {
    const ctx = setup({ organizer: true, approval: true })
    await screen.findByText('Звук подключён')
    ctx.api.room.emitEvent({ type: 'join-request', requestId: 'r1', name: 'Катя' })
    expect(ctx.playCue).toHaveBeenLastCalledWith('knock', '')
  })
})

describe('the tray (#44)', () => {
  it('shows the call in the tray menu as it is', async () => {
    const ctx = setup()
    await screen.findByText('Звук подключён')
    expect(ctx.api.tray.update).toHaveBeenLastCalledWith({
      inCall: true,
      roomName: 'Вечерний созвон',
      muted: false,
      deafened: false,
    })
    await ctx.user.keyboard('{Control>}{Shift>}m{/Shift}{/Control}')
    expect(ctx.api.tray.update).toHaveBeenLastCalledWith(expect.objectContaining({ muted: true }))
  })

  it('acts on the tray menu: microphone, sound, leaving', async () => {
    const ctx = setup()
    await screen.findByText('Звук подключён')
    ctx.api.tray.emitCommand('mute')
    expect(await screen.findByRole('button', { name: 'Включить микрофон' })).toBeTruthy()
    ctx.api.tray.emitCommand('deafen')
    expect(screen.getByRole('button', { name: 'Включить звук' })).toBeTruthy()
    ctx.api.tray.emitCommand('leave')
    await vi.waitFor(() => {
      expect(ctx.onLeft).toHaveBeenCalled()
    })
    expect(ctx.api.tray.update).toHaveBeenLastCalledWith({
      inCall: false,
      roomName: '',
      muted: false,
      deafened: false,
    })
  })
})

describe('the chat (#45)', () => {
  it('sends with Enter, a new line with Shift+Enter; the host echo shows the message', async () => {
    const ctx = setup()
    await screen.findByText('Звук подключён')
    ctx.api.room.request.mockImplementation((request) => {
      if (request.method === 'sendChat') {
        ctx.api.room.emitEvent({ type: 'chat', peerId: 'me', text: request.text })
      }
      return Promise.resolve({ ok: true, data: {} })
    })
    await ctx.user.click(screen.getByRole('button', { name: 'Чат' }))
    const field = screen.getByRole('textbox', { name: 'Сообщение' })
    expect(document.activeElement).toBe(field)
    await ctx.user.type(field, 'первая{Shift>}{Enter}{/Shift}вторая{Enter}')

    expect(ctx.api.room.request).toHaveBeenCalledWith({
      method: 'sendChat',
      text: 'первая\nвторая',
    })
    const chat = screen.getByRole('complementary', { name: 'Чат' })
    expect(await within(chat).findByText(/первая\s+вторая/)).toBeTruthy()
    expect(within(chat).getByText('Алексей')).toBeTruthy()
    expect((field as HTMLTextAreaElement).value).toBe('')
    // Typing does not reach the M hotkey.
    expect(ctx.setMuted).not.toHaveBeenCalledWith(true)
  })

  it('counts unread messages while closed and opens links through main', async () => {
    const ctx = setup()
    await screen.findByText('Звук подключён')
    ctx.api.room.emitEvent({ type: 'chat', peerId: 'dima', text: 'см. https://example.com/a.' })
    ctx.api.room.emitEvent({ type: 'chat', peerId: 'dima', text: 'ещё' })
    const button = await screen.findByRole('button', { name: 'Чат, новых сообщений: 2' })

    await ctx.user.click(button)
    expect(screen.getByRole('button', { name: 'Чат' })).toBeTruthy()
    const chat = screen.getByRole('complementary', { name: 'Чат' })
    expect(within(chat).getAllByText('Дима')).toHaveLength(1)
    await ctx.user.click(within(chat).getByRole('link', { name: 'https://example.com/a' }))
    expect(ctx.api.app.openLink).toHaveBeenCalledWith('https://example.com/a')
  })

  it('says so when messages go too fast, and keeps the draft', async () => {
    const ctx = setup()
    await screen.findByText('Звук подключён')
    ctx.api.room.request.mockResolvedValue({ ok: false, error: 'too many messages' })
    await ctx.user.click(screen.getByRole('button', { name: 'Чат' }))
    const field = screen.getByRole('textbox', { name: 'Сообщение' })
    await ctx.user.type(field, 'быстро{Enter}')
    expect(await screen.findByText(/Слишком много сообщений подряд/)).toBeTruthy()
    expect((field as HTMLTextAreaElement).value).toBe('быстро')
  })
})

describe('the organizer in the call (#87)', () => {
  it('marks the organizer’s tile, the user’s own too when they are the organizer', async () => {
    const ctx = setup({ organizer: true })
    await screen.findByText('Звук подключён')
    ctx.api.room.emitEvent({ type: 'peer-joined', peer: { id: 'olya', name: 'Оля' } })
    await vi.waitFor(() => {
      expect(ctx.labels()).toEqual(['Дима', 'Оля', 'Алексей (я), организатор'])
    })
  })

  it('marks someone else as the organizer', async () => {
    const ctx = setup()
    await screen.findByText('Звук подключён')
    ctx.api.room.emitEvent({
      type: 'peer-joined',
      peer: { id: 'org', name: 'Организатор', organizer: true },
    })
    await vi.waitFor(() => {
      expect(ctx.labels()).toContain('Организатор, организатор')
    })
    expect(screen.getAllByText('организатор')).toHaveLength(1)
  })

  it('shows the organizer’s upload, and warns when it is short of the call', async () => {
    const ctx = setup()
    await screen.findByText('Звук подключён')
    ctx.api.room.emitEvent({
      type: 'host-stats',
      uploadMbps: 39.4,
      participants: 15,
      screen: '720p',
      measured: true,
    })
    // In the link's tooltip, not a line of its own (#110).
    expect(
      await screen.findByRole('status', {
        name: /Отдача организатора 39 Мбит\/с — хватит на 15 человек и экран в 720p/,
      }),
    ).toBeTruthy()
    expect(screen.queryByText('Отдача организатора 39 Мбит/с')).toBeNull()
    expect(screen.queryByText(/не хватает скорости отдачи/)).toBeNull()

    ctx.api.room.emitEvent({
      type: 'host-stats',
      uploadMbps: 0.2,
      participants: 1,
      screen: null,
      measured: true,
    })
    expect(await screen.findByText(/Организатору не хватает скорости отдачи на всех/)).toBeTruthy()
  })
})
