import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { parseInvite } from '@shared/invite'
import type { NetworkCheckResult } from '@shared/network'
import {
  installRatatoskMock,
  MOCK_FINGERPRINT,
  PUBLIC_IPV4_CHECK,
} from '../../../test/ratatosk-mock'
import { CreateRoomScreen } from './CreateRoomScreen'

function show(options: Parameters<typeof installRatatoskMock>[0] = {}, profileName = 'Алексей') {
  const api = installRatatoskMock(options)
  const onBack = vi.fn()
  render(() => <CreateRoomScreen profileName={profileName} onBack={onBack} />)
  return { api, onBack, user: userEvent.setup() }
}

const linkText = async () => (await screen.findByText(/^ratatosk:\/\/join/)).textContent

describe('CreateRoomScreen', () => {
  it('shows the network check with the upload estimate and a ready link', async () => {
    show({ measureUpload: () => Promise.resolve({ status: 'measured', mbps: 92, measuredAt: 0 }) })

    expect(await screen.findByText('Порт 47000 открыт через UPnP')).toBeTruthy()
    expect(screen.getByText('Внешний адрес: 93.184.216.34')).toBeTruthy()
    expect(
      await screen.findByText('Отдача 92 Мбит/с — хватит на 15 человек и экран в 1080p'),
    ).toBeTruthy()
    expect(screen.getByText('Друзья смогут подключиться к тебе напрямую.')).toBeTruthy()
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
    expect(screen.getByText('Нельзя хостить: роутер не открывает порты автоматически')).toBeTruthy()
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
    })
    expect(api.room.join).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Алексей', password: 'secret' }) as unknown,
    )
    expect(await screen.findByText('Комната открыта. Отправь ссылку друзьям.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Назад' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Закрыть комнату' }))
    expect(api.host.stop).toHaveBeenCalledOnce()
    expect(await screen.findByRole('button', { name: 'Открыть комнату' })).toBeTruthy()
  })

  it('requires a room name, and a name when the profile has none', async () => {
    const { api, user } = show({}, '')

    await user.click(screen.getByRole('button', { name: 'Открыть комнату' }))

    expect(screen.getByText('Назови комнату — это название увидят друзья')).toBeTruthy()
    expect(screen.getByText('Введи имя — его увидят остальные')).toBeTruthy()
    expect(api.host.start).not.toHaveBeenCalled()
  })

  it('explains a busy port and checks another one from «Дополнительно»', async () => {
    const { api, user } = show({
      hostStart: () => Promise.resolve({ status: 'stopped', lastError: 'port-in-use' }),
    })
    await user.type(screen.getByLabelText('Название комнаты'), 'Комната')
    await user.click(screen.getByRole('button', { name: 'Открыть комнату' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Порт 47000 занят другой программой. Выбери другой в «Дополнительно».',
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
