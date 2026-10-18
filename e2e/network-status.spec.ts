import { expect, test } from '@playwright/test'
import { launchApp } from './app'

test('the home screen shows whether this computer can host', async () => {
  const { app, page } = await launchApp()
  try {
    const footer = page.locator('footer.network-status')

    // With port mapping turned off (e2e), the honest answer is "cannot tell, check by hand".
    await expect(footer).toContainText(
      'Этот компьютер не может быть организатором: автоматический проброс порта выключен',
    )
    await expect(footer).toContainText('Порт 47000 должен быть проброшен на роутере')
    await expect(footer.getByRole('button', { name: 'Проверить снова' })).toBeVisible()
  } finally {
    await app.close()
  }
})

test('network check result is available over IPC', async () => {
  const { app, page } = await launchApp()
  try {
    const result = await page.evaluate(() => window.tolki.network.check({ force: true }))

    expect(result).toMatchObject({
      port: 47000,
      portMapping: { status: 'disabled' },
      verdict: { canHost: false, problem: 'mapping-disabled' },
    })
    expect(typeof result.checkedAt).toBe('number')
  } finally {
    await app.close()
  }
})
