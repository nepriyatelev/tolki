import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
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
  const onError = vi.fn()
  render(() => (
    <JoinScreen
      result={parseInvite(buildInvite(invite))}
      onBack={() => undefined}
      onError={onError}
    />
  ))
  return { api, onError, user: userEvent.setup() }
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

  it.each([
    ['TOO_MANY_ATTEMPTS', { kind: 'too-many-attempts' }],
    ['ROOM_FULL', { kind: 'room-full' }],
    ['VERSION_MISMATCH', { kind: 'update-required', reason: 'host-version' }],
    ['unreachable', { kind: 'host-offline' }],
    ['timeout', { kind: 'host-offline' }],
  ] as const)('hands %s over to a full error screen', async (error, screenKind) => {
    const { onError, user } = setup(INVITE, { ok: false, error })

    await user.type(screen.getByLabelText('Твоё имя'), 'Миша')
    await user.click(screen.getByRole('button', { name: 'Войти в комнату' }))

    expect(onError).toHaveBeenCalledWith(screenKind)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('leaves the room', async () => {
    const { api, user } = setup(INVITE, ok)
    await user.type(screen.getByLabelText('Твоё имя'), 'Алексей')
    await user.click(screen.getByRole('button', { name: 'Войти в комнату' }))

    await user.click(await screen.findByRole('button', { name: 'Выйти' }))

    expect(api.room.leave).toHaveBeenCalledOnce()
    expect(await screen.findByRole('button', { name: 'Войти в комнату' })).toBeTruthy()
  })

  it('prefills the remembered name', () => {
    installRatatoskMock()
    render(() => (
      <JoinScreen
        result={parseInvite(buildInvite(INVITE))}
        onBack={() => undefined}
        profileName="Алексей"
      />
    ))

    expect(screen.getByLabelText<HTMLInputElement>('Твоё имя').value).toBe('Алексей')
  })

  it('uses the saved password of a recent room, and asks again if the host rejects it', async () => {
    const user = userEvent.setup()
    const api = installRatatoskMock({
      join: () => Promise.resolve({ ok: false, error: 'WRONG_PASSWORD' }),
    })
    render(() => (
      <JoinScreen
        result={parseInvite(buildInvite(INVITE))}
        onBack={() => undefined}
        profileName="Алексей"
        recent={{ id: 'recent-1', passwordSaved: true }}
      />
    ))
    expect(await screen.findByText('Пароль сохранён')).toBeTruthy()
    expect(screen.queryByLabelText('Пароль комнаты')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Войти в комнату' }))

    expect(api.room.join).toHaveBeenCalledWith({
      invite: { ...INVITE, password: undefined },
      name: 'Алексей',
      recentId: 'recent-1',
    })
    expect(await screen.findByLabelText('Пароль комнаты')).toBeTruthy()
    expect(screen.getByText('Неверный пароль')).toBeTruthy()
  })
})
