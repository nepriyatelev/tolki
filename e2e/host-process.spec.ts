import { createHash, X509Certificate } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer, type AddressInfo, type Server } from 'node:net'
import { join } from 'node:path'
import type { TLSSocket } from 'node:tls'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { WebSocket } from 'ws'
import { launchApp } from './app'

// Port mapping is off in e2e: it would touch the real router of whoever runs the tests.
// Mapping logic is covered by unit tests against a fake PCP server (src/host/nat).

function hostProcessCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(
    ({ app: electronApp }) =>
      electronApp.getAppMetrics().filter((m) => m.type === 'Utility' && m.name === 'Ratatosk Host')
        .length,
  )
}

async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => {
    probe.listen(0, resolve)
  })
  const { port } = probe.address() as AddressInfo
  await new Promise<void>((resolve) => {
    probe.close(() => {
      resolve()
    })
  })
  return port
}

async function occupy(port: number): Promise<Server> {
  const server = createServer()
  await new Promise<void>((resolve) => {
    server.listen(port, resolve)
  })
  return server
}

/** Connects the way the client will: TLS without a CA, then compare the fingerprint. */
function connectWss(port: number): Promise<{ socket: WebSocket; fingerprint: string }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`wss://127.0.0.1:${port}/`, { rejectUnauthorized: false })
    socket.once('upgrade', (res) => {
      const peer = (res.socket as TLSSocket).getPeerX509Certificate()
      if (!peer) {
        reject(new Error('no peer certificate'))
        return
      }
      const fingerprint = createHash('sha256')
        .update(new X509Certificate(peer.toString()).raw)
        .digest('base64url')
      resolve({ socket, fingerprint })
    })
    socket.once('error', reject)
  })
}

test('main starts the host with a WSS server on the given port and stops it', async () => {
  const { app, page } = await launchApp()
  try {
    const port = await freePort()
    expect(await page.evaluate(() => window.ratatosk.host.getState())).toEqual({
      status: 'stopped',
    })

    const events = page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const seen: string[] = []
          const off = window.ratatosk.host.onState((state) => {
            seen.push(state.status)
            if (state.status === 'stopped') {
              off()
              resolve(seen)
            }
          })
        }),
    )

    const state = await page.evaluate(
      (p) => window.ratatosk.host.start({ port: p, portMapping: false }),
      port,
    )
    expect(state).toMatchObject({ status: 'running', port, portMapping: { status: 'disabled' } })
    const fingerprint = state.status === 'running' ? state.fingerprint : ''
    expect(fingerprint).toMatch(/^[A-Za-z0-9_-]{43}$/)
    await expect.poll(() => hostProcessCount(app)).toBe(1)

    const { socket, fingerprint: presented } = await connectWss(port)
    expect(presented).toBe(fingerprint)
    const closed = new Promise<number>((resolve) => {
      socket.once('close', (code) => {
        resolve(code)
      })
    })

    expect(await page.evaluate(() => window.ratatosk.host.stop())).toEqual({ status: 'stopped' })
    expect(await closed).toBe(1001)
    await expect.poll(() => hostProcessCount(app)).toBe(0)
    // The port is released.
    const reuse = await occupy(port)
    reuse.close()

    expect(await events).toEqual(['starting', 'running', 'stopping', 'stopped'])
  } finally {
    await app.close()
  }
})

test('defaults to port 47000', async () => {
  const { app, page } = await launchApp()
  try {
    const state = await page.evaluate(() => window.ratatosk.host.start({ portMapping: false }))

    expect(state).toMatchObject({ status: 'running', port: 47000 })
  } finally {
    await app.close()
  }
})

test('the certificate is created once per installation and kept in userData', async () => {
  const first = await launchApp()
  const port = await freePort()
  let fingerprint: string
  try {
    const state = await first.page.evaluate(
      (p) => window.ratatosk.host.start({ port: p, portMapping: false }),
      port,
    )
    fingerprint = state.status === 'running' ? state.fingerprint : ''
    expect(existsSync(join(first.userDataDir, 'host-certificate.json'))).toBe(true)
  } finally {
    await first.app.close()
  }

  const second = await launchApp({ userDataDir: first.userDataDir })
  try {
    const state = await second.page.evaluate(
      (p) => window.ratatosk.host.start({ port: p, portMapping: false }),
      port,
    )
    expect(state).toMatchObject({ status: 'running', fingerprint })
  } finally {
    await second.app.close()
  }
})

test('a busy port is reported, not thrown', async () => {
  const { app, page } = await launchApp()
  const port = await freePort()
  const blocker = await occupy(port)
  try {
    const state = await page.evaluate(
      (p) => window.ratatosk.host.start({ port: p, portMapping: false }),
      port,
    )

    expect(state).toEqual({ status: 'stopped', lastError: 'port-in-use' })
    await expect.poll(() => hostProcessCount(app)).toBe(0)
  } finally {
    blocker.close()
    await app.close()
  }
})

test('invalid ports are rejected by IPC validation', async () => {
  const { app, page } = await launchApp()
  try {
    const error = await page.evaluate(() =>
      window.ratatosk.host.start({ port: 80 }).then(
        () => null,
        (e: unknown) => String(e),
      ),
    )

    expect(error).toContain('host:start')
  } finally {
    await app.close()
  }
})

test('quitting the app stops a running host', async () => {
  const { app, page } = await launchApp()
  const port = await freePort()

  expect(
    await page.evaluate((p) => window.ratatosk.host.start({ port: p, portMapping: false }), port),
  ).toMatchObject({
    status: 'running',
  })
  const pid = await app.evaluate(
    ({ app: electronApp }) =>
      electronApp.getAppMetrics().find((m) => m.name === 'Ratatosk Host')?.pid,
  )
  expect(pid).toBeDefined()

  await app.close()

  expect(() => process.kill(pid as number, 0)).toThrow()
  const reuse = await occupy(port)
  reuse.close()
})
