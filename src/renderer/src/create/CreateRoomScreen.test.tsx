import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { parseInvite } from '@shared/invite'
import type { NetworkCheckResult } from '@shared/network'
import { installTolkiMock, MOCK_FINGERPRINT, PUBLIC_IPV4_CHECK } from '../../../test/tolki-mock'
import { CreateRoomScreen } from './CreateRoomScreen'

/** The real call needs WebRTC; the call screen only needs a handle. */
const startCall = vi.fn(() =>
  Promise.resolve({
    sending: true,
    setMuted: () => Promise.resolve(),
    setTransmitting: () => undefined,
    setInputDevice: () => Promise.resolve(),
    startScreen: () => Promise.resolve(),
    stopScreen: () => Promise.resolve(),
    setScreenBudget: () => Promise.resolve(),
    setScreenVisible: () => Promise.resolve(),
    setScreenLayer: () => Promise.resolve(),
    requestScreen: () => Promise.resolve(),
    answerScreenRequest: () => Promise.resolve(),
    screenSample: () => Promise.resolve(null),
    connectionSample: () => Promise.resolve(null),
    close: () => undefined,
  }),
)

function show(options: Parameters<typeof installTolkiMock>[0] = {}, profileName = 'Алексей') {
  const api = installTolkiMock(options)
  const onBack = vi.fn()
  render(() => <CreateRoomScreen profileName={profileName} onBack={onBack} startCall={startCall} />)
  return { api, onBack, user: userEvent.setup() }
}

const linkText = async () => (await screen.findByText(/^tolki:\/\/join/)).textContent

describe('CreateRoomScreen', () => {
  it('shows the network check with the upload estimate and a ready link', async () => {
    show({ measureUpload: () => Promise.resolve({ status: 'measured', mbps: 92, measuredAt: 0 }) })

    expect(await screen.findByText('Порт 47000 открыт через UPnP')).toBeTruthy()
    expect(screen.getByText('Внешний адрес: 93.184.216.34')).toBeTruthy()
    expect(
      await screen.findByText('Отдача 92 Мбит/с — хватит на 15 человек и экран в 1080p'),
    ).toBeTruthy()
    expect(
      screen.getByText('Участники смогут подключаться к этому компьютеру напрямую.'),
    ).toBeTruthy()
    expect(parseInvite(await linkText())).toMatchObject({
      ok: true,
      invite: { host: '93.184.216.34', port: 47000, fingerprint: MOCK_FINGERPRINT },
    })
  })

  it('hides the upload line when the speed test is off', async () => {
    show()

    await screen.findByText('Порт 47000 открыт через UPnP')
    expect(screen.queryByText(/^Отдача/)).toBeNull()
  })

  it('generates a word password and can embed it in the link', async () => {
    const { user } = show()
    await linkText()

    await user.click(screen.getByRole('button', { name: 'Сгенерировать' }))
    const password = screen.getByLabelText<HTMLInputElement>('Пароль').value
    expect(password).toMatch(/^[а-яё]+-[а-яё]+-\d{2}$/)
    expect(await linkText()).not.toContain('k=')

    await user.click(screen.getByRole('checkbox', { name: 'Вшить пароль в ссылку' }))
    expect(parseInvite(await linkText())).toMatchObject({ invite: { password } })
  })

  it('copies the link', async () => {
    const { api, user } = show()
    const link = await linkText()

    await user.click(screen.getByRole('button', { name: 'Скопировать ссылку' }))

    expect(api.app.copyText).toHaveBeenCalledWith(link)
    expect(screen.getByRole('button', { name: 'Ссылка скопирована' })).toBeTruthy()
  })

  it('explains when there is no link to make', async () => {
    const cannot: NetworkCheckResult = {
      ...PUBLIC_IPV4_CHECK,
      portMapping: { status: 'failed', reason: 'unsupported', detail: '' },
      verdict: { canHost: false, problem: 'unsupported' },
    }
    show({ check: () => Promise.resolve(cannot) })

    expect(await screen.findByText(/Ссылку не из чего собрать/)).toBeTruthy()
    expect(
      screen.getByText(
        'Этот компьютер не может быть организатором: роутер не открывает порты автоматически',
      ),
    ).toBeTruthy()
  })

  it('opens the room: starts the host with name and password and joins it over localhost', async () => {
    const { api, user } = show()
    await linkText()

    await user.type(screen.getByLabelText('Название комнаты'), 'Вечерний созвон')
    await user.type(screen.getByLabelText('Пароль'), 'secret')
    await user.click(screen.getByRole('button', { name: 'Открыть комнату' }))

    expect(api.host.start).toHaveBeenCalledWith({
      port: 47000,
      roomName: 'Вечерний созвон',
      password: 'secret',
      screenMode: 'auto',
      approval: false,
    })
    expect(api.room.join).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Алексей', password: 'secret' }) as unknown,
    )
  })

  it('puts the organizer into the call; «Пригласить» copies the link (#100)', async () => {
    const { api, user } = show()
    const link = await linkText()
    await user.type(screen.getByLabelText('Название комнаты'), 'Вечерний созвон')
    await user.click(screen.getByRole('button', { name: 'Открыть комнату' }))

    // The call screen of the room, with the organizer's microphone and the others' voices.
    expect(await screen.findByText('Звук подключён')).toBeTruthy()
    expect(startCall).toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'Новая комната' })).toBeNull()
    // The room is on this computer: no «N мс · через организатора» for the organizer.
    expect(screen.queryByText(/через организатора/)).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Пригласить' }))
    expect(api.app.copyText).toHaveBeenCalledWith(link)
    expect(screen.getByRole('button', { name: 'Ссылка скопирована' })).toBeTruthy()
  })

  it('on macOS says the microphone will be asked, and asks before the room opens (#85)', async () => {
    const { api, user } = show({ permissions: { microphone: 'not-asked' } })
    expect(await screen.findByText(/macOS спросит доступ к микрофону/)).toBeTruthy()
    await user.type(screen.getByLabelText('Название комнаты'), 'Вечерний созвон')
    await user.click(screen.getByRole('button', { name: 'Открыть комнату' }))
    expect(api.permissions.request).toHaveBeenCalledWith('microphone')
    expect(api.permissions.request.mock.invocationCallOrder[0]).toBeLessThan(
      api.host.start.mock.invocationCallOrder[0] ?? 0,
    )
    expect(await screen.findByText('Звук подключён')).toBeTruthy()
  })

  it('does not mention the microphone when it is already allowed', async () => {
    const { api } = show()
    await vi.waitFor(() => {
      expect(api.permissions.status).toHaveBeenCalledWith('microphone')
    })
    expect(screen.queryByText(/спросит доступ к микрофону/)).toBeNull()
  })

  it('closes the room for everyone when the organizer leaves the call (#100)', async () => {
    const { api, onBack, user } = show()
    await user.type(screen.getByLabelText('Название комнаты'), 'Вечерний созвон')
    await user.click(screen.getByRole('button', { name: 'Открыть комнату' }))
    await screen.findByText('Звук подключён')

    await user.click(screen.getByRole('button', { name: 'Выйти' }))

    expect(api.room.leave).toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(api.host.stop).toHaveBeenCalledOnce()
    })
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('has no «Пригласить» without a link to share', async () => {
    const cannot: NetworkCheckResult = {
      ...PUBLIC_IPV4_CHECK,
      portMapping: { status: 'failed', reason: 'unsupported', detail: '' },
      verdict: { canHost: false, problem: 'unsupported' },
    }
    const { user } = show({ check: () => Promise.resolve(cannot) })
    await screen.findByText(/Ссылку не из чего собрать/)
    await user.type(screen.getByLabelText('Название комнаты'), 'Вечерний созвон')
    await user.click(screen.getByRole('button', { name: 'Открыть комнату' }))
    await screen.findByText('Звук подключён')

    expect(screen.queryByRole('button', { name: 'Пригласить' })).toBeNull()
  })

  it('requires a room name, and a name when the profile has none', async () => {
    const { api, user } = show({}, '')

    await user.click(screen.getByRole('button', { name: 'Открыть комнату' }))

    expect(screen.getByText('Нужно название — его увидят участники')).toBeTruthy()
    expect(screen.getByText('Нужно имя — его увидят участники')).toBeTruthy()
    expect(api.host.start).not.toHaveBeenCalled()
  })

  it('explains a busy port and checks another one from «Дополнительно»', async () => {
    const { api, user } = show({
      hostStart: () => Promise.resolve({ status: 'stopped', lastError: 'port-in-use' }),
    })
    await user.type(screen.getByLabelText('Название комнаты'), 'Комната')
    await user.click(screen.getByRole('button', { name: 'Открыть комнату' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Порт 47000 занят другой программой. Другой порт можно указать в «Дополнительно».',
    )

    await user.click(screen.getByText('Дополнительно'))
    const port = screen.getByLabelText('Порт')
    await user.clear(port)
    await user.type(port, '80')
    await user.tab()
    expect(screen.getByText('Порт — число от 1024 до 65535')).toBeTruthy()

    await user.clear(port)
    await user.type(port, '47001')
    await user.tab()
    await vi.waitFor(() => {
      expect(api.network.check).toHaveBeenLastCalledWith({ port: 47001, force: false })
    })
  })
})
