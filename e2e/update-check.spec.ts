import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test } from '@playwright/test'
import { launchApp } from './app'

// PLAN #36: on launch the app asks for the latest release and offers a newer one. GitHub is
// replaced by a local stub; the request itself is checked to carry nothing about the user.
// A release asks for /releases/latest, an alpha (a packaged alpha build, #46) for the list.

async function stub(
  tag: string,
): Promise<{ server: Server; url: string; requests: IncomingMessage[] }> {
  const requests: IncomingMessage[] = []
  const server = createServer((request, response) => {
    requests.push(request)
    response.setHeader('Content-Type', 'application/json')
    const release = { tag_name: tag, draft: false, html_url: 'https://example.invalid' }
    response.end(JSON.stringify(request.url === '/releases/latest' ? release : [release]))
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address() as AddressInfo
  return { server, url: `http://127.0.0.1:${port}`, requests }
}

test('a newer release shows «Доступна версия X» on the home screen', async () => {
  const github = await stub('v99.0.0')
  const { app, page } = await launchApp({
    env: { TOLKI_UPDATE_CHECK: 'on', TOLKI_UPDATE_API: github.url },
  })
  try {
    await expect(page.getByText('Доступна версия 99.0.0')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Скачать' })).toBeVisible()
    // One plain GET: no query, no cookies, nothing that identifies the user.
    expect(github.requests).toHaveLength(1)
    expect(github.requests[0]?.method).toBe('GET')
    expect(github.requests[0]?.url).toMatch(/^\/releases(\/latest|\?per_page=10)$/)
    expect(github.requests[0]?.headers.cookie).toBeUndefined()
    // For review (uploaded with test-results on CI).
    await page.screenshot({ path: 'test-results/update-banner.png' })

    await page.getByRole('button', { name: 'Скрыть' }).click()
    await expect(page.getByText(/Доступна версия/)).toHaveCount(0)
  } finally {
    await app.close()
    github.server.close()
  }
})

test('the same version: no banner', async () => {
  const github = await stub('v0.0.0')
  const { app, page } = await launchApp({
    env: { TOLKI_UPDATE_CHECK: 'on', TOLKI_UPDATE_API: github.url },
  })
  try {
    await expect.poll(() => github.requests.length).toBe(1)
    await page.waitForTimeout(500)
    await expect(page.getByText(/Доступна версия/)).toHaveCount(0)
  } finally {
    await app.close()
    github.server.close()
  }
})
