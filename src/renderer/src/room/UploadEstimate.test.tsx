import { render, screen } from '@solidjs/testing-library'
import { describe, expect, it } from 'vitest'
import type { UploadMeasurement } from '@shared/upload-capacity'
import { installTolkiMock } from '../../../test/tolki-mock'
import { UploadEstimate } from './UploadEstimate'

describe('UploadEstimate', () => {
  it('shows progress, then the estimate', async () => {
    let resolve: (value: UploadMeasurement) => void = () => undefined
    installTolkiMock({
      measureUpload: () =>
        new Promise((r) => {
          resolve = r
        }),
    })
    render(() => <UploadEstimate />)

    expect(screen.getByText('Замер отдачи…')).toBeTruthy()
    resolve({ status: 'measured', mbps: 92, measuredAt: 0 })

    expect(
      await screen.findByText('Отдача 92 Мбит/с — хватит на 15 человек и экран в 1080p'),
    ).toBeTruthy()
  })

  it.each([{ status: 'disabled' as const }, { status: 'failed' as const, detail: 'offline' }])(
    'renders nothing when the test is $status',
    async (measurement) => {
      installTolkiMock({ measureUpload: () => Promise.resolve(measurement) })
      const { container } = render(() => <UploadEstimate />)

      await Promise.resolve()
      await new Promise((r) => setTimeout(r, 0))
      expect(container.textContent).toBe('')
    },
  )
})
