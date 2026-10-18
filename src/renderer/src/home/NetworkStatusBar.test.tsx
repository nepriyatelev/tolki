import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { NetworkCheckResult } from '@shared/network'
import { installRatatoskMock, PUBLIC_IPV4_CHECK } from '../../../test/ratatosk-mock'
import { NetworkStatusBar } from './NetworkStatusBar'

describe('NetworkStatusBar', () => {
  it('shows progress, then the verdict with details', async () => {
    let resolve: (value: NetworkCheckResult) => void = () => undefined
    installRatatoskMock({
      check: () =>
        new Promise((r) => {
          resolve = r
        }),
    })
    render(() => <NetworkStatusBar />)

    expect(screen.getByText('Проверка сети…')).toBeTruthy()
    resolve(PUBLIC_IPV4_CHECK)

    expect(
      await screen.findByText('Этот компьютер может быть организатором: порт открыт через UPnP'),
    ).toBeTruthy()
    expect(screen.getByText('Внешний адрес 93.184.216.34')).toBeTruthy()
  })

  it('first asks for a possibly cached check, then forces a new one on retry', async () => {
    const user = userEvent.setup()
    const api = installRatatoskMock()
    render(() => <NetworkStatusBar />)

    await user.click(await screen.findByRole('button', { name: 'Проверить снова' }))

    expect(api.network.check.mock.calls).toEqual([[{ force: false }], [{ force: true }]])
  })

  it('shows a plain message if the check itself fails', async () => {
    installRatatoskMock({ check: () => Promise.reject(new Error('boom')) })
    render(() => <NetworkStatusBar />)

    expect(await screen.findByText('Не удалось проверить сеть')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Проверить снова' })).toBeTruthy()
  })

  it('announces updates politely to screen readers', () => {
    installRatatoskMock()
    const { container } = render(() => <NetworkStatusBar />)

    expect(container.querySelector('footer')?.getAttribute('aria-live')).toBe('polite')
  })
})
