import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { buildInvite, parseInvite, type Invite } from '@shared/invite'
import type { RoomPreview } from '@shared/room'
import { installRatatoskMock } from '../../../test/ratatosk-mock'
import { JoinScreen, peopleText } from './JoinScreen'
import type { MicrophoneAccess } from '../audio/microphone'

const INVITE: Invite = {
  host: '203.0.113.5',
  hostKind: 'ipv4',
  port: 47000,
  roomId: 'vecherniy',
  fingerprint: '2_SqXt3l45Ay59VWqBcvcLmeh7BmqvL0m-UwbNw3EiE',
}

const silentMic: MicrophoneAccess = {
  listInputs: () => Promise.resolve([]),
  listOutputs: () => Promise.resolve([]),
  openMeter: () => Promise.resolve(() => undefined),
}

function show(invite: Invite, preview?: RoomPreview) {
  const api = installRatatoskMock(preview ? { preview } : {})
  const onBack = vi.fn()
  render(() => (
    <JoinScreen result={parseInvite(buildInvite(invite))} onBack={onBack} microphone={silentMic} />
  ))
  return { api, onBack }
}

describe('JoinScreen', () => {
  it('shows the room name and only the number of people, never names', async () => {
    const { api } = show(INVITE)

    expect(await screen.findByRole('heading', { name: 'Вечерний созвон' })).toBeTruthy()
    expect(screen.getByText('В комнате 2 человека')).toBeTruthy()
    expect(screen.getByText('203.0.113.5:47000')).toBeTruthy()
    expect(
      screen.getByText('Подключение напрямую к хосту · сертификат совпадает со ссылкой'),
    ).toBeTruthy()
    // The light check never carries the password.
    expect(api.room.preview).toHaveBeenCalledWith({
      host: '203.0.113.5',
      hostKind: 'ipv4',
      port: 47000,
      roomId: 'vecherniy',
      fingerprint: INVITE.fingerprint,
    })
  })

  it('does not send an embedded password to the check, and says it is in the link', async () => {
    const { api } = show({ ...INVITE, host: '2a02:6b8::1', hostKind: 'ipv6', password: 'лиса' })

    expect(await screen.findByText('[2a02:6b8::1]:47000')).toBeTruthy()
    expect(api.room.preview.mock.calls[0]?.[0]).not.toHaveProperty('password')
    expect(screen.getByText('Пароль вшит в ссылку')).toBeTruthy()
    expect(screen.queryByLabelText('Пароль комнаты')).toBeNull()
    expect(screen.queryByText('лиса')).toBeNull()
  })

  it('does not ask for a password when the room has none', async () => {
    show(INVITE, {
      status: 'live',
      room: { name: 'Вечерний созвон', peerCount: 2, hasPassword: false },
    })

    await screen.findByRole('heading', { name: 'Вечерний созвон' })
    expect(screen.queryByLabelText('Пароль комнаты')).toBeNull()
  })

  it('warns about a changed certificate and does not let the user join', async () => {
    show(INVITE, { status: 'certificate-changed' })

    expect((await screen.findByRole('alert')).textContent).toContain('Не подключайся')
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Войти в комнату' }).disabled,
    ).toBe(true)
  })

  it('still lets the user try when the host is offline', async () => {
    show(INVITE, { status: 'offline' })

    expect(await screen.findByText('Хост сейчас не в сети')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Вход по ссылке' })).toBeTruthy()
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Войти в комнату' }).disabled,
    ).toBe(false)
  })

  it('explains a broken link and asks to update the app for a newer one', () => {
    installRatatoskMock()
    render(() => (
      <JoinScreen result={parseInvite('ratatosk://join?v=2')} onBack={() => undefined} />
    ))

    expect(screen.getByRole('heading', { name: 'Не получилось открыть ссылку' })).toBeTruthy()
    expect(screen.getByText(/Обнови приложение/)).toBeTruthy()
  })

  it('cancels', async () => {
    const user = userEvent.setup()
    const { onBack } = show(INVITE)

    await user.click(screen.getByRole('button', { name: 'Отмена' }))

    expect(onBack).toHaveBeenCalledOnce()
  })
})

describe('peopleText', () => {
  it.each<[RoomPreview | undefined, string]>([
    [undefined, 'Проверяем комнату…'],
    [
      { status: 'live', room: { name: 'x', peerCount: 0, hasPassword: false } },
      'Пока никого нет — ты будешь первым',
    ],
    [
      { status: 'live', room: { name: 'x', peerCount: 1, hasPassword: false } },
      'В комнате 1 человек',
    ],
    [
      { status: 'live', room: { name: 'x', peerCount: 5, hasPassword: false } },
      'В комнате 5 человек',
    ],
    [{ status: 'offline' }, 'Хост сейчас не в сети'],
    [{ status: 'certificate-changed' }, 'Не удалось проверить комнату'],
  ])('%j → %s', (preview, text) => {
    expect(peopleText(preview)).toBe(text)
  })
})
