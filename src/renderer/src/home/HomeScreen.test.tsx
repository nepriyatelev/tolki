import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { RecentRoom } from '@shared/recent'
import { installRatatoskMock } from '../../../test/ratatosk-mock'
import { HomeScreen } from './HomeScreen'

const FP = '2_SqXt3l45Ay59VWqBcvcLmeh7BmqvL0m-UwbNw3EiE'
const LINK = `ratatosk://join?v=1&h=203.0.113.5&p=47000&r=vecherniy&fp=${FP}`
const room = (id: string, roomName: string, passwordSaved = false): RecentRoom => ({
  id,
  invite: { host: '203.0.113.5', hostKind: 'ipv4', port: 47000, roomId: id, fingerprint: FP },
  roomName,
  lastUsedAt: Date.now(),
  passwordSaved,
})

function show(options: Parameters<typeof installRatatoskMock>[0] = {}, profileName = '') {
  const api = installRatatoskMock(options)
  const onOpenInvite = vi.fn()
  const onOpenRecent = vi.fn()
  const onCreateRoom = vi.fn()
  render(() => (
    <HomeScreen
      profileName={profileName}
      onOpenInvite={onOpenInvite}
      onOpenRecent={onOpenRecent}
      onCreateRoom={onCreateRoom}
    />
  ))
  return { api, onOpenInvite, onOpenRecent, onCreateRoom, user: userEvent.setup() }
}

describe('HomeScreen', () => {
  it('stays neutral: no greeting and no chatty question (#88)', () => {
    show({}, 'Алексей')

    expect(screen.queryByText(/Привет/)).toBeNull()
    expect(screen.queryByText(/созвонимся/)).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Ratatosk' })).toBeTruthy()
  })

  it('goes to room creation', async () => {
    const { onCreateRoom, user } = show()

    await user.click(screen.getByRole('button', { name: 'Создать комнату' }))

    expect(onCreateRoom).toHaveBeenCalledOnce()
  })

  it('opens a pasted invite link', async () => {
    const { onOpenInvite, user } = show()

    await user.type(screen.getByLabelText('Ссылка-приглашение'), LINK)
    await user.click(screen.getByRole('button', { name: 'Войти' }))

    expect(onOpenInvite).toHaveBeenCalledOnce()
    expect(onOpenInvite.mock.calls[0]?.[0]).toMatchObject({
      ok: true,
      invite: { roomId: 'vecherniy' },
    })
  })

  it('explains an empty or broken link right under the field', async () => {
    const { onOpenInvite, user } = show()

    await user.click(screen.getByRole('button', { name: 'Войти' }))
    expect(screen.getByText('Нужна ссылка-приглашение')).toBeTruthy()

    await user.type(screen.getByLabelText('Ссылка-приглашение'), 'https://example.com')
    await user.click(screen.getByRole('button', { name: 'Войти' }))
    expect(screen.getByText('Это не ссылка-приглашение Ratatosk.')).toBeTruthy()
    expect(onOpenInvite).not.toHaveBeenCalled()
  })

  it('lists recent rooms with only the number of people and opens them', async () => {
    const live = room('a', 'Вечерний созвон', true)
    const offline = room('b', 'Кино по пятницам')
    const { onOpenRecent, user } = show({
      recentRooms: [live, offline],
      recentStatuses: { a: { status: 'live', peerCount: 2 }, b: { status: 'offline' } },
    })

    const rows = await screen.findAllByRole('listitem')
    expect(within(rows[0] as HTMLElement).getByText('Вечерний созвон')).toBeTruthy()
    expect(await within(rows[0] as HTMLElement).findByText('Идёт · 2 человека')).toBeTruthy()
    expect(within(rows[0] as HTMLElement).getByText(/пароль сохранён/)).toBeTruthy()
    expect(within(rows[1] as HTMLElement).getByText('Организатор не в сети')).toBeTruthy()

    await user.click(within(rows[0] as HTMLElement).getByRole('button', { name: 'Подключиться' }))
    expect(onOpenRecent).toHaveBeenCalledWith(live)
  })

  it('removes a room from the list', async () => {
    const { api, user } = show({ recentRooms: [room('a', 'Вечерний созвон')] })

    await user.click(
      await screen.findByRole('button', { name: 'Убрать «Вечерний созвон» из недавних' }),
    )

    expect(api.recent.remove).toHaveBeenCalledWith('a')
    expect(await screen.findByText('Здесь появятся комнаты после первого входа.')).toBeTruthy()
  })

  it('does not offer to connect when the certificate changed', async () => {
    show({
      recentRooms: [room('a', 'Вечерний созвон')],
      recentStatuses: { a: { status: 'certificate-changed' } },
    })

    expect(await screen.findByText('Сертификат изменился')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Подключиться' }).disabled).toBe(
      true,
    )
  })
})
