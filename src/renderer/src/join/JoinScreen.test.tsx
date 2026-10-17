import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { buildInvite, parseInvite, type Invite } from '@shared/invite'
import { JoinScreen } from './JoinScreen'

const FP = '2_SqXt3l45Ay59VWqBcvcLmeh7BmqvL0m-UwbNw3EiE'
const INVITE: Invite = {
  host: '203.0.113.5',
  hostKind: 'ipv4',
  port: 47000,
  roomId: 'vecherniy',
  fingerprint: FP,
}

function show(invite: Invite) {
  const onBack = vi.fn()
  render(() => <JoinScreen result={parseInvite(buildInvite(invite))} onBack={onBack} />)
  return onBack
}

describe('JoinScreen', () => {
  it('shows what the link contains', () => {
    show(INVITE)

    expect(screen.getByRole('heading', { name: 'Вход по ссылке' })).toBeTruthy()
    expect(screen.getByText('203.0.113.5:47000')).toBeTruthy()
    expect(screen.getByText('vecherniy')).toBeTruthy()
    expect(screen.getByText('спроси у хоста')).toBeTruthy()
    expect(screen.getByText(`${FP.slice(0, 12)}…`)).toBeTruthy()
  })

  it('puts IPv6 hosts in brackets and says when the password is embedded', () => {
    show({ ...INVITE, host: '2a02:6b8::1', hostKind: 'ipv6', password: 'лиса-маяк-42' })

    expect(screen.getByText('[2a02:6b8::1]:47000')).toBeTruthy()
    expect(screen.getByText('вшит в ссылку')).toBeTruthy()
    // The password itself is never shown.
    expect(screen.queryByText('лиса-маяк-42')).toBeNull()
  })

  it('explains a broken link and asks to update the app for a newer one', () => {
    render(() => (
      <JoinScreen result={parseInvite('ratatosk://join?v=2')} onBack={() => undefined} />
    ))

    expect(screen.getByRole('heading', { name: 'Не получилось открыть ссылку' })).toBeTruthy()
    expect(screen.getByText(/Обнови приложение/)).toBeTruthy()
  })

  it('goes back', async () => {
    const user = userEvent.setup()
    const onBack = show(INVITE)

    await user.click(screen.getByRole('button', { name: 'Назад' }))

    expect(onBack).toHaveBeenCalledOnce()
  })
})
