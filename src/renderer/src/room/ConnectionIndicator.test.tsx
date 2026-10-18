import { render, screen } from '@solidjs/testing-library'
import { describe, expect, it } from 'vitest'
import type { ConnectionSample } from './call'
import { ConnectionIndicator } from './ConnectionIndicator'

const SAMPLE: ConnectionSample = { rttMs: 24, protocol: 'tcp', packetsReceived: 10, packetsLost: 0 }

describe('ConnectionIndicator', () => {
  it('shows the round trip and the protocol, coloured by quality', async () => {
    render(() => <ConnectionIndicator sample={() => Promise.resolve(SAMPLE)} offline={false} />)

    const status = await screen.findByText('24 мс · через организатора (TCP)')
    expect(status.classList).toContain('connection--good')
    expect(status.getAttribute('aria-label')).toContain('задержка 24 мс')
  })

  it('says there is no connection while reconnecting', () => {
    render(() => <ConnectionIndicator sample={() => Promise.resolve(SAMPLE)} offline={true} />)
    const status = screen.getByRole('status', { name: 'Нет связи с организатором' })
    expect(status.textContent).toBe('Нет связи')
    expect(status.classList).toContain('connection--poor')
  })
})
