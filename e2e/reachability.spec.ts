import { createSocket } from 'node:dgram'
import { createServer, type IncomingMessage } from 'node:http'
import { connect, type AddressInfo } from 'node:net'
import { expect, test } from '@playwright/test'
import { launchApp } from './app'
import { freePort } from './ports'

// #128: the router does not open the port (in e2e it is never asked), but the port was forwarded
// by hand. A STUN stub gives the external address, a port-checker stub knocks on the port the
// way the real one would — here on localhost — and the room gets its link.

const EXTERNAL = '93.184.216.34'

function stunStub() {
  const socket = createSocket('udp4')
  socket.on('message', (request, from) => {
    const message = Buffer.alloc(32)
    message.writeUInt16BE(0x0101, 0)
    message.writeUInt16BE(12, 2)
    request.copy(message, 4, 4, 20)
    message.writeUInt16BE(0x0020, 20)
    message.writeUInt16BE(8, 22)
    message[25] = 0x01
    const cookie = [0x21, 0x12, 0xa4, 0x42]
    EXTERNAL.split('.').forEach((part, i) => {
      message[28 + i] = Number(part) ^ (cookie[i] ?? 0)
    })
    socket.send(message, from.port, from.address)
  })
  return new Promise<{ address: string; close: () => void }>((resolve) => {
    socket.bind(0, '127.0.0.1', () => {
      const { port } = socket.address()
      resolve({ address: `127.0.0.1:${port}`, close: () => socket.close() })
    })
  })
}

function portCheckerStub(open: boolean) {
  const requests: IncomingMessage[] = []
  const server = createServer((request, response) => {
    requests.push(request)
    const port = Number(/\/port\/(\d+)$/.exec(request.url ?? '')?.[1])
    // Knock on the port, as the real checker does from the internet.
    const socket = connect(port, '127.0.0.1')
    const reply = (reachable: boolean) => {
      socket.destroy()
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ ip: EXTERNAL, port, reachable: open && reachable }))
    }
    socket.once('connect', () => {
      reply(true)
    })
    socket.once('error', () => {
      reply(false)
    })
  })
  return new Promise<{ url: string; requests: IncomingMessage[]; close: () => void }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({ url: `http://127.0.0.1:${port}`, requests, close: () => server.close() })
    })
  })
}

for (const open of [true, false]) {
  test(`a port forwarded by hand is ${open ? 'found from outside' : 'reported closed'}`, async () => {
    test.setTimeout(60_000)
    const stun = await stunStub()
    const checker = await portCheckerStub(open)
    const port = await freePort()
    const { app, page } = await launchApp({
      env: {
        TOLKI_REACHABILITY: 'on',
        TOLKI_STUN: stun.address,
        TOLKI_PORT_CHECK_API: checker.url,
      },
    })
    try {
      await page.getByRole('button', { name: 'Создать комнату' }).click()
      await page.getByText('Дополнительно').click()
      await page.getByLabel('Порт').fill(String(port))
      await page.getByLabel('Порт').blur()
      await page.getByRole('button', { name: 'Проверить снова' }).click()

      await expect(page.getByText(`Внешний адрес: ${EXTERNAL}`)).toBeVisible({ timeout: 20_000 })
      if (open) {
        await expect(page.getByText(`Порт ${port} доступен снаружи`)).toBeVisible()
        await expect(page.getByText(new RegExp(`^tolki://join.*h=${EXTERNAL}`))).toBeVisible()
        await page.screenshot({ path: test.info().outputPath('reachable.png') })
      } else {
        await expect(page.getByText(`Порт ${port} закрыт снаружи`)).toBeVisible()
        await expect(
          page.getByText('Этот компьютер не может быть организатором: порт закрыт снаружи'),
        ).toBeVisible()
        await page.screenshot({ path: test.info().outputPath('closed.png') })
      }
      // Only the address and the port go to the checker: a plain GET, no cookies.
      expect(checker.requests.every((r) => r.method === 'GET' && !r.headers.cookie)).toBe(true)
      expect(checker.requests.some((r) => r.url === `/port/${port}`)).toBe(true)
    } finally {
      await app.close()
      stun.close()
      checker.close()
    }
  })
}
