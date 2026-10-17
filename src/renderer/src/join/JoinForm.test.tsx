import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { buildInvite, parseInvite, type Invite } from '@shared/invite'
import type { JoinResult } from '@shared/room'
import { installRatatoskMock } from '../../../test/ratatosk-mock'
import { JoinScreen } from './JoinScreen'

const INVITE: Invite = {
  host: '203.0.113.5',
  hostKind: 'ipv4',
  port: 47000,
  roomId: 'vecherniy',
  fingerprint: '2_SqXt3l45Ay59VWqBcvcLmeh7BmqvL0m-UwbNw3EiE',
}

function setup(invite: Invite, result: JoinResult) {
  const api = installRatatoskMock({ join: () => Promise.resolve(result) })
  render(() => <JoinScreen result={parseInvite(buildInvite(invite))} onBack={() => undefined} />)
  return { api, user: userEvent.setup() }
}

const ok: JoinResult = {
  ok: true,
  peerId: 'me',
  peers: [{ id: '1', name: 'Дима' }],
  room: { name: 'Вечерний созвон', peerCount: 1, hasPassword: true },
}

describe('join form', () => {
  it('sends the name and typed password, then shows that the user is in the room', async () => {
    const { api, user } = setup(INVITE, ok)

    await user.type(screen.getByLabelText('Твоё имя'), '  Алексей ')
    await user.type(screen.getByLabelText('Пароль комнаты'), 'лиса-маяк-42')
    await user.click(screen.getByRole('button', { name: 'Войти в комнату' }))

    expect(api.room.join).toHaveBeenCalledWith({
      invite: { ...INVITE, password: undefined },
      name: 'Алексей',
      password: 'лиса-маяк-42',
    })
    expect(
      await screen.findByText('Ты в комнате «Вечерний созвон». Участников вместе с тобой: 2.'),
    ).toBeTruthy()
  })

  it('does not ask for a password embedded in the link', async () => {
    const { api, user } = setup({ ...INVITE, password: 'secret' }, ok)

    expect(screen.queryByLabelText('Пароль комнаты')).toBeNull()
    await user.type(screen.getByLabelText('Твоё имя'), 'Катя')
    await user.click(screen.getByRole('button', { name: 'Войти в комнату' }))

    expect(api.room.join.mock.calls[0]?.[0]).not.toHaveProperty('password')
  })

  it('requires a name', async () => {
    const { api, user } = setup(INVITE, ok)

    await user.click(screen.getByRole('button', { name: 'Войти в комнату' }))

    expect(screen.getByText('Введи имя — его увидят остальные')).toBeTruthy()
    expect(api.room.join).not.toHaveBeenCalled()
  })

  it('shows WRONG_PASSWORD under the password field', async () => {
    const { user } = setup(INVITE, { ok: false, error: 'WRONG_PASSWORD' })

    await user.type(screen.getByLabelText('Твоё имя'), 'Миша')
    await user.click(screen.getByRole('button', { name: 'Войти в комнату' }))

    const password = await screen.findByLabelText('Пароль комнаты')
    await screen.findByText('Неверный пароль')
    expect(password.getAttribute('aria-invalid')).toBe('true')
  })

  it('shows TOO_MANY_ATTEMPTS as an alert', async () => {
    const { user } = setup(INVITE, { ok: false, error: 'TOO_MANY_ATTEMPTS' })

    await user.type(screen.getByLabelText('Твоё имя'), 'Миша')
    await user.click(screen.getByRole('button', { name: 'Войти в комнату' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Слишком много неверных попыток. Подожди минуту и попробуй снова.',
    )
  })

  it('leaves the room', async () => {
    const { api, user } = setup(INVITE, ok)
    await user.type(screen.getByLabelText('Твоё имя'), 'Алексей')
    await user.click(screen.getByRole('button', { name: 'Войти в комнату' }))

    await user.click(await screen.findByRole('button', { name: 'Выйти' }))

    expect(api.room.leave).toHaveBeenCalledOnce()
    expect(await screen.findByRole('button', { name: 'Войти в комнату' })).toBeTruthy()
  })
})
