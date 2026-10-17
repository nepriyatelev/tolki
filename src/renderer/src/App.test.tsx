import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { parseInvite } from '@shared/invite'
import { installRatatoskMock } from '../../test/ratatosk-mock'
import { App } from './App'

const LINK =
  'ratatosk://join?v=1&h=203.0.113.5&p=47000&r=vecherniy&fp=2_SqXt3l45Ay59VWqBcvcLmeh7BmqvL0m-UwbNw3EiE'

describe('App', () => {
  it('renders the home screen placeholder', () => {
    installRatatoskMock()
    render(() => <App />)

    expect(screen.getByRole('heading', { level: 1, name: 'С кем созвонимся?' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Создать комнату' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Войти по ссылке' })).toBeTruthy()
  })

  it('opens the join screen for a link that started the app', async () => {
    installRatatoskMock({ pendingInvite: parseInvite(LINK) })
    render(() => <App />)

    expect(await screen.findByRole('heading', { name: 'Вход по ссылке' })).toBeTruthy()
    expect(screen.getByText('203.0.113.5:47000')).toBeTruthy()
  })

  it('opens the join screen when a link arrives while the app is open, and goes back', async () => {
    const user = userEvent.setup()
    const api = installRatatoskMock()
    render(() => <App />)
    await Promise.resolve()

    api.invite.emit(parseInvite(LINK))
    expect(await screen.findByRole('heading', { name: 'Вход по ссылке' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Назад' }))
    expect(screen.getByRole('heading', { name: 'С кем созвонимся?' })).toBeTruthy()
  })
})
