import { writeFileSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { cpus, networkInterfaces, platform, release, totalmem } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { launchApp } from '../e2e/app'
import { footprintBytes, processTree, processUsage } from './process-usage'

// PLAN §6, #34: cold start, the app idle without a call, and a participant's app in a voice
// call. Writes docs/perf/budgets.md.

const FAKE_MEDIA = '--use-fake-device-for-media-stream'
const STARTS = 5
const WARM_UP_MS = 10_000
const MEASURE_MS = 30_000

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

function lanAddress(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('198.18.')) {
        return entry.address
      }
    }
  }
  return '127.0.0.1'
}

const fmt = (n: number, digits = 1) => n.toLocaleString('ru-RU', { maximumFractionDigits: digits })
const median = (list: number[]) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)] ?? 0

interface Usage {
  /** % of one core. */
  cpu: number
  /** Physical footprint (macOS) or PSS (Linux) of every process. */
  memoryMb: number
  /** The working set summed over processes: counts shared framework pages in each. */
  workingSetMb: number
}

/** CPU of the app's processes over MEASURE_MS and its memory at the end. */
async function usageOf(app: ElectronApplication): Promise<Usage> {
  const pid = await app.evaluate(() => process.pid)
  const tree = processTree(pid)
  const cpuSeconds = () => tree.reduce((sum, p) => sum + processUsage(p).cpuSeconds, 0)
  const startedAt = Date.now()
  const before = cpuSeconds()
  await new Promise((resolve) => setTimeout(resolve, MEASURE_MS))
  const cpu = ((cpuSeconds() - before) / ((Date.now() - startedAt) / 1000)) * 100
  const metrics = await app.evaluate(({ app }) =>
    app.getAppMetrics().map((m) => ({ pid: m.pid, workingSetKb: m.memory.workingSetSize })),
  )
  return {
    cpu,
    memoryMb: footprintBytes(metrics.map((m) => m.pid)) / 1024 ** 2,
    workingSetMb: metrics.reduce((sum, m) => sum + m.workingSetKb, 0) / 1024,
  }
}

test('cold start, idle and a voice call within the budgets', async () => {
  test.setTimeout(600_000)
  const cores = cpus().length
  const pct = (oneCore: number) => `${fmt(oneCore / cores)} % (${fmt(oneCore)} % ядра)`

  // Cold start: from launching the executable to the window on screen (shown on ready-to-show,
  // i.e. after the first paint). A fresh profile every time; the time includes Playwright's
  // own launch overhead, so it is an upper bound.
  const starts: number[] = []
  for (let i = 0; i < STARTS; i++) {
    const startedAt = Date.now()
    const { app } = await launchApp()
    await expect
      .poll(
        () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible()),
        { intervals: [10], timeout: 10_000 },
      )
      .toBe(true)
    starts.push(Date.now() - startedAt)
    await app.close()
  }

  // Idle: the home screen, nothing going on; then the window hidden (minimized / in the tray).
  const idle = await launchApp()
  await idle.page.waitForTimeout(WARM_UP_MS)
  const idleShown = await usageOf(idle.app)
  await idle.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.minimize())
  await idle.page.waitForTimeout(WARM_UP_MS)
  const idleHidden = await usageOf(idle.app)
  await idle.app.close()

  // A voice call: the organizer, two more participants talking and the measured participant —
  // all four microphones play Chromium's fake beeping tone, so three voices come in.
  const host = await launchApp({ args: [FAKE_MEDIA] })
  const port = await freePort()
  const state = await host.page.evaluate(
    (p) =>
      window.ratatosk.host.start({ port: p, portMapping: false, roomName: 'Бюджет', password: '' }),
    port,
  )
  if (state.status !== 'running') throw new Error('host did not start')
  const link = `ratatosk://join?v=1&h=127.0.0.1&p=${port}&r=b&fp=${state.fingerprint}`
  await host.page.getByLabel('Ссылка-приглашение').fill(link)
  await host.page.getByRole('button', { name: 'Войти', exact: true }).click()
  await host.page.getByLabel('Имя', { exact: true }).fill('Организатор')
  await host.page.getByRole('button', { name: 'Войти в комнату' }).click()
  await expect(host.page.getByText('Звук подключён')).toBeVisible()
  const others = await electron.launch({
    args: [
      join(__dirname, 'clients-main.mjs'),
      `wss://127.0.0.1:${port}/`,
      lanAddress(),
      '2',
      'share=0',
    ],
  })
  const client = await launchApp({ args: [FAKE_MEDIA, link] })
  let voice: Usage
  let screen: Usage
  try {
    await client.page.getByLabel('Имя', { exact: true }).fill('Участник')
    await client.page.getByRole('button', { name: 'Войти в комнату' }).click()
    await expect(client.page.getByText('Звук подключён')).toBeVisible()
    await expect(client.page.locator('audio[data-peer-id]')).toHaveCount(3, { timeout: 30_000 })
    await client.page.waitForTimeout(WARM_UP_MS)
    voice = await usageOf(client.app)

    // For reference: the same participant watching a shared 1080p screen.
    const sharer = await electron.launch({
      args: [join(__dirname, 'clients-main.mjs'), `wss://127.0.0.1:${port}/`, lanAddress(), '1'],
    })
    try {
      await expect(client.page.locator('video')).not.toHaveCount(0, { timeout: 30_000 })
      await client.page.waitForTimeout(WARM_UP_MS)
      screen = await usageOf(client.app)
    } finally {
      await sharer.close()
    }
  } finally {
    await client.app.close()
    await others.close()
    await host.app.close()
  }

  const verdict = (ok: boolean) => (ok ? '✅' : '❌')
  const report = `# Бюджеты производительности (#34)

Сгенерировано \`pnpm perf:budgets\`, ${new Date().toISOString().slice(0, 10)}.
Машина: ${cpus()[0]?.model ?? 'CPU'}, ${cores} ядер, ${fmt(totalmem() / 1024 ** 3, 0)} ГБ, ${platform()} ${release()}.
Сборка: ${process.env['E2E_EXECUTABLE'] ? 'установочная (`E2E_EXECUTABLE`)' : '`out/` (electron-vite build)'}.

CPU — процессорное время всех процессов приложения из ОС за ${MEASURE_MS / 1000} с после ${WARM_UP_MS / 1000} с разгона; «% ядра» — от одного ядра, основная цифра — от всех ядер, как у бюджета хоста в PLAN §6. Память — физический объём всех процессов приложения, как в «Мониторинге системы» на macOS (physical footprint; на Linux — PSS). Сумма working set (RSS) по процессам больше: общие страницы фреймворка Electron, отображённые в каждый процесс, в ней считаются в каждом; она дана для справки.

| Бюджет (PLAN §6) | Цель | Замер | |
|---|---|---|---|
| Холодный старт: от запуска до окна на экране | ≤ 2 с | ${fmt(median(starts) / 1000, 2)} с (медиана ${STARTS} запусков: ${starts.map((s) => fmt(s / 1000, 2)).join(', ')}) | ${verdict(median(starts) <= 2000)} |
| Без звонка, окно открыто | ≈ 0 | ${pct(idleShown.cpu)} | ${verdict(idleShown.cpu < 1)} |
| Без звонка, окно свёрнуто | ≈ 0 | ${pct(idleHidden.cpu)} | ${verdict(idleHidden.cpu < 1)} |
| Участник в голосовом звонке (слышит 3 голоса, говорит сам): CPU | ≤ 5 % | ${pct(voice.cpu)} | ${verdict(voice.cpu / cores <= 5)} |
| Участник в голосовом звонке: память | ≤ 250 МБ | ${fmt(voice.memoryMb, 0)} МБ (сумма RSS ${fmt(voice.workingSetMb, 0)} МБ) | ${verdict(voice.memoryMb <= 250)} |

Для справки — тот же участник смотрит демонстрацию 1080p (бюджета нет): CPU ${pct(screen.cpu)}, память ${fmt(screen.memoryMb, 0)} МБ (сумма RSS ${fmt(screen.workingSetMb, 0)} МБ).

«≈ 0» засчитывается, если меньше 1 % одного ядра.
`
  writeFileSync(join(__dirname, '../docs/perf/budgets.md'), report)
  console.log(report)
})
