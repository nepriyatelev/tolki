import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseInvite } from '@shared/invite'
import { installTolkiMock } from '../../../test/tolki-mock'
import { App } from '../App'
import { RetryButton } from './RetryButton'

const LINK =
  'tolki://join?v=1&h=203.0.113.5&p=47000&r=vecherniy&fp=2_SqXt3l45Ay59VWqBcvcLmeh7BmqvL0m-UwbNw3EiE'

afterEach(() => {
  vi.useRealTimers()
})

describe('RetryButton', () => {
  it('stays locked for the given time, then retries', async () => {
    vi.useFakeTimers()
    const onRetry = vi.fn()
    render(() => <RetryButton waitSeconds={3} onRetry={onRetry} />)

    expect(screen.getByRole<HTMLButtonElement>('button').disabled).toBe(true)
    expect(screen.getByRole('button').textContent).toBe('Попробовать снова через 3 с')
    await vi.advanceTimersByTimeAsync(3000)

    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Попробовать снова' })
    expect(button.disabled).toBe(false)
    button.click()
    expect(onRetry).toHaveBeenCalledOnce()
  })
})

describe('error screens in the app', () => {
  it('shows «Нужна новая версия» for a link from a newer version and opens the download page', async () => {
    const user = userEvent.setup()
    const api = installTolkiMock({ pendingInvite: parseInvite('tolki://join?v=2') })
    render(() => <App />)

    expect(await screen.findByRole('heading', { name: 'Нужна новая версия' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Скачать новую версию' }))
    expect(api.app.openDownloadPage).toHaveBeenCalledOnce()
  })

  it('shows «Организатор не в сети» when joining fails, and retries the same link', async () => {
    const user = userEvent.setup()
    const api = installTolkiMock({
      pendingInvite: parseInvite(LINK),
      join: () => Promise.resolve({ ok: false, error: 'unreachable' }),
    })
    render(() => <App />)

    await user.type(await screen.findByLabelText('Имя'), 'Миша')
    await user.type(screen.getByLabelText('Пароль комнаты'), 'x')
    await user.click(screen.getByRole('button', { name: 'Войти в комнату' }))

    expect(await screen.findByRole('heading', { name: 'Организатор не в сети' })).toBeTruthy()
    expect(screen.getByText('Что можно сделать')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Попробовать снова' }))
    expect(await screen.findByRole('button', { name: 'Войти в комнату' })).toBeTruthy()
    expect(api.room.preview).toHaveBeenCalledTimes(2)
  })

  it('locks retrying for a minute after too many wrong passwords', async () => {
    const user = userEvent.setup()
    installTolkiMock({
      pendingInvite: parseInvite(LINK),
      join: () => Promise.resolve({ ok: false, error: 'TOO_MANY_ATTEMPTS' }),
    })
    render(() => <App />)

    await user.type(await screen.findByLabelText('Имя'), 'Миша')
    await user.click(screen.getByRole('button', { name: 'Войти в комнату' }))

    expect(await screen.findByRole('heading', { name: 'Неверный пароль' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Попробовать снова через 60 с/ })).toBeTruthy()
  })

  it('shows «Организатор закрыл комнату» or «Связь потеряна» when the room ends', async () => {
    const api = installTolkiMock()
    render(() => <App />)
    await screen.findByRole('heading', { name: 'Tolki' })

    api.room.emitClosed({ reason: 'host-closed', roomName: 'Кино' })
    expect(await screen.findByRole('heading', { name: 'Организатор закрыл комнату' })).toBeTruthy()

    api.room.emitClosed({ reason: 'connection-lost', roomName: 'Кино' })
    expect(await screen.findByRole('heading', { name: 'Связь с комнатой потеряна' })).toBeTruthy()
  })

  it('tells a removed participant so, and lets them try to come back (#42)', async () => {
    const user = userEvent.setup()
    const api = installTolkiMock({ pendingInvite: parseInvite(LINK) })
    render(() => <App />)
    expect(await screen.findByRole('button', { name: 'Войти в комнату' })).toBeTruthy()

    api.room.emitClosed({ reason: 'removed', roomName: 'Кино' })
    expect(await screen.findByRole('heading', { name: 'Удаление из комнаты' })).toBeTruthy()
    expect(screen.getByText(/Войти снова можно по той же ссылке/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Попробовать снова' }))
    expect(await screen.findByRole('button', { name: 'Войти в комнату' })).toBeTruthy()
  })

  it('lets the user try the same room again after the link was lost for good (#31)', async () => {
    const user = userEvent.setup()
    const api = installTolkiMock({ pendingInvite: parseInvite(LINK) })
    render(() => <App />)
    expect(await screen.findByRole('button', { name: 'Войти в комнату' })).toBeTruthy()

    api.room.emitClosed({ reason: 'connection-lost', roomName: 'Кино' })
    expect(await screen.findByRole('heading', { name: 'Связь с комнатой потеряна' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Попробовать снова' }))

    expect(await screen.findByRole('button', { name: 'Войти в комнату' })).toBeTruthy()
  })
})
