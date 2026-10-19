import { createHash, X509Certificate } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { join } from 'node:path'
import type { TLSSocket } from 'node:tls'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { WebSocket } from 'ws'
import { freePort } from './ports'
import { launchApp } from './app'

// Port mapping is off in e2e: it would touch the real router of whoever runs the tests.
// Mapping logic is covered by unit tests against a fake PCP server (src/host/nat).

function hostProcessCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(
    ({ app: electronApp }) =>
      electronApp.getAppMetrics().filter((m) => m.type === 'Utility' && m.name === 'Tolki Host')
        .length,
  )
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
    expect(await page.evaluate(() => window.tolki.host.getState())).toEqual({
      status: 'stopped',
    })

    const events = page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const seen: string[] = []
          const off = window.tolki.host.onState((state) => {
            seen.push(state.status)
            if (state.status === 'stopped') {
              off()
              resolve(seen)
            }
          })
        }),
    )

    const state = await page.evaluate(
      (p) => window.tolki.host.start({ port: p, portMapping: false }),
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

    expect(await page.evaluate(() => window.tolki.host.stop())).toEqual({ status: 'stopped' })
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
    const state = await page.evaluate(() => window.tolki.host.start({ portMapping: false }))

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
      (p) => window.tolki.host.start({ port: p, portMapping: false }),
      port,
    )
    fingerprint = state.status === 'running' ? state.fingerprint : ''
    expect(existsSync(join(first.userDataDir, 'host-certificate.json'))).toBe(true)
  } finally {
    await first.app.close()
  }

  const second = await launchApp({ userDataDir: first.userDataDir })
  try {
    // A fresh port: the first app's host may still be letting go of its port (seen on CI).
    // The certificate is what this test is about.
    const state = await second.page.evaluate(
      (p) => window.tolki.host.start({ port: p, portMapping: false }),
      await freePort(),
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
      (p) => window.tolki.host.start({ port: p, portMapping: false }),
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
      window.tolki.host.start({ port: 80 }).then(
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
    await page.evaluate((p) => window.tolki.host.start({ port: p, portMapping: false }), port),
  ).toMatchObject({
    status: 'running',
  })
  const pid = await app.evaluate(
    ({ app: electronApp }) => electronApp.getAppMetrics().find((m) => m.name === 'Tolki Host')?.pid,
  )
  expect(pid).toBeDefined()

  await app.close()

  expect(() => process.kill(pid as number, 0)).toThrow()
  const reuse = await occupy(port)
  reuse.close()
})

test('the host runs the SFU: media transports share the room port', async () => {
  const { app, page } = await launchApp()
  try {
    const port = await freePort()
    await page.evaluate((p) => window.tolki.host.start({ port: p, portMapping: false }), port)
    const { socket } = await connectWss(port)
    const messages: { type: string; [key: string]: unknown }[] = []
    const next = (type: string) =>
      expect
        .poll(() => messages.find((m) => m.type === type), { timeout: 5000 })
        .toBeTruthy()
        .then(() => messages.find((m) => m.type === type))
    socket.on('message', (data) => {
      messages.push(JSON.parse((data as Buffer).toString('utf8')) as (typeof messages)[number])
    })

    socket.send(JSON.stringify({ type: 'hello', protocolVersion: 1 }))
    await next('challenge')
    socket.send(JSON.stringify({ type: 'auth', name: 'Тест', hmac: null }))
    expect(JSON.stringify(await next('welcome'))).toContain('audio/opus')

    socket.send(
      JSON.stringify({
        type: 'request',
        id: 1,
        request: { method: 'createTransport', direction: 'recv' },
      }),
    )
    const response = (await next('response')) as unknown as {
      data: { iceCandidates: { protocol: string; port: number }[] }
    }
    expect(response.data.iceCandidates.map((c) => [c.protocol, c.port]).sort()).toEqual([
      ['tcp', port],
      ['udp', port],
    ])
    socket.close()
  } finally {
    await app.close()
  }
})
