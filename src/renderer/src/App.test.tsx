import { render, screen } from '@solidjs/testing-library'
import { describe, expect, it } from 'vitest'
import { App } from './App'

describe('App', () => {
  it('renders the home screen placeholder', () => {
    render(() => <App />)

    expect(screen.getByRole('heading', { level: 1, name: 'С кем созвонимся?' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Создать комнату' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Войти по ссылке' })).toBeTruthy()
  })
})
