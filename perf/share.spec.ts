import { writeFileSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { cpus, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { launchApp } from '../e2e/app'
import { processTree, processUsage } from './process-usage'

// #34: what sharing a 1080p60 moving screen costs the sharer. One participant shares a canvas
// with constant motion; the organizer (the real app) watches it. The same canvas drawn without
// sending anything is the baseline: the difference is what sending costs.

const VARIANTS = [
  ['none', 'ничего не отправляется (только рисование canvas) — база'],
  ['app', 'как в приложении: ≈1080p H.264 + ≈360p VP8'],
] as const

const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 1 })

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

test('the sharer’s CPU for a 1080p60 moving screen', async () => {
  test.setTimeout(600_000)
  const rows: string[] = []
  const cpu: Record<string, number> = {}
  let hardware = false
  const only = process.env['SHARE_VARIANTS']?.split(',')
  for (const [variant, title] of VARIANTS.filter(([v]) => !only || only.includes(v))) {
    const host = await launchApp()
    try {
      const port = await freePort()
      const state = await host.page.evaluate(
        (p) =>
          window.tolki.host.start({
            port: p,
            portMapping: false,
            roomName: 'Экран',
            password: '',
          }),
        port,
      )
      if (state.status !== 'running') throw new Error('host did not start')
      const link = `tolki://join?v=1&h=127.0.0.1&p=${port}&r=s&fp=${state.fingerprint}`
      await host.page.getByLabel('Ссылка-приглашение').fill(link)
      await host.page.getByRole('button', { name: 'Войти', exact: true }).click()
      await host.page.getByLabel('Имя', { exact: true }).fill('Зритель')
      await host.page.getByRole('button', { name: 'Войти в комнату' }).click()

      const sharer = await electron.launch({
        args: [
          join(__dirname, 'clients-main.mjs'),
          `wss://127.0.0.1:${port}/`,
          lanAddress(),
          '1',
          `source=motion&variant=${variant}`,
        ],
      })
      try {
        const page = await sharer.firstWindow()
        await expect
          .poll(() => page.evaluate(() => window.loadError ?? (window.loadClient ? 'ok' : '')), {
            timeout: 60_000,
          })
          .toBe('ok')
        await page.waitForTimeout(10_000)
        const pid = await sharer.evaluate(() => process.pid)
        const tree = processTree(pid)
        const cpuSeconds = () => tree.reduce((sum, p) => sum + processUsage(p).cpuSeconds, 0)
        const startedAt = Date.now()
        const before = cpuSeconds()
        await page.waitForTimeout(20_000)
        const oneCore = ((cpuSeconds() - before) / ((Date.now() - startedAt) / 1000)) * 100
        const stats = await page.evaluate(() => window.loadClient?.stats())
        const encoders = stats?.encoders.join(' + ') || '—'
        cpu[variant] = oneCore
        if (variant === 'app') hardware = stats?.hardwareEncoder ?? false
        rows.push(
          `| ${title} | ${encoders} | ${fmt(oneCore)} % | ${fmt(oneCore / cpus().length)} % |`,
        )
      } finally {
        await sharer.close()
      }
    } finally {
      await host.app.close()
    }
  }
  const sending = (cpu['app'] ?? 0) - (cpu['none'] ?? 0)
  const ok = hardware && sending <= 15
  const report = `# CPU показывающего: экран 1080p, 60 к/с, движение (#34)

Сгенерировано \`pnpm perf:share\`, ${new Date().toISOString().slice(0, 10)}; ${cpus()[0]?.model ?? 'CPU'}, ${cpus().length} ядер.

Показывающий — отдельный Electron с тем же кодом звонка, что в приложении; «экран» — canvas 1920×1080 с постоянным движением, 60 к/с; смотрит организатор (настоящее приложение). CPU — все процессы показывающего за 20 с после 10 с разгона, по процессорному времени из ОС. Рисование canvas входит во все строки; его цена — строка «база».

| Как отправляется | Поток: размер, к/с, кодировщик | CPU, % одного ядра | CPU, % всех ядер |
|---|---|---|---|
${rows.join('\n')}

**Цена отправки** (разница строк): ${fmt(sending)} % одного ядра, ${fmt(sending / cpus().length)} % всех ядер; кодировщик ≈1080p ${hardware ? 'аппаратный' : '**не аппаратный**'}. Критерий #27 «≤ 15 % при аппаратном кодеке» (считаем строже — от одного ядра): ${ok ? '✅' : '❌'}.

Размер и частота кадров — что кодировщик выдаёт в конце замера: при постоянном движении по всему кадру браузер сам снижает размер, чтобы уложиться в битрейт режима «Плавно» (2,8 Мбит/с); на обычном экране (окно, игра) кадр больше похож на предыдущий, и размер остаётся полным.
`
  writeFileSync(join(__dirname, '../docs/perf/share-cpu.md'), report)
  console.log(report)
})
