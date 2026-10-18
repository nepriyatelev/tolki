import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { cpus, networkInterfaces, platform, release, totalmem } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { launchApp } from '../e2e/app'
import type { ClientStats } from './client/client'
import { tapPeerConnections } from '../e2e/media'
import { processTree, processUsage } from './process-usage'

// PLAN #33: the organizer (the real app) and 14 participants with fake microphones, one of them
// sharing a fake 1080p screen. Measures the organizer's room server (host process + mediasoup
// worker) against PLAN §6 and writes docs/perf/load-15.md.

const PARTICIPANTS = 14
const WARM_UP_MS = 15_000
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

/** This machine's LAN address: on loopback Chromium has no UDP candidates (see #32). */
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

test('15 people and one screen: the organizer’s room server within budget', async () => {
  const host = await launchApp()
  const port = await freePort()
  const state = await host.page.evaluate(
    (p) =>
      window.ratatosk.host.start({
        port: p,
        portMapping: false,
        roomName: 'Нагрузка',
        password: '',
      }),
    port,
  )
  if (state.status !== 'running') throw new Error('host did not start')
  const mediaHost = lanAddress()
  const link = `ratatosk://join?v=1&h=127.0.0.1&p=${port}&r=load&fp=${state.fingerprint}`

  // The organizer is a participant too, through the app's own UI — the one real client here,
  // so voice latency is read from it.
  await tapPeerConnections(host.page)
  await host.page.getByLabel('Ссылка-приглашение').fill(link)
  await host.page.getByRole('button', { name: 'Войти', exact: true }).click()
  await host.page.getByLabel('Имя', { exact: true }).fill('Организатор')
  await host.page.getByRole('button', { name: 'Войти в комнату' }).click()
  await expect(host.page.getByText(/Звук подключён|только прослушивание/)).toBeVisible()

  const clients = await electron.launch({
    args: [
      join(__dirname, 'clients-main.mjs'),
      `wss://127.0.0.1:${port}/`,
      mediaHost,
      String(PARTICIPANTS),
    ],
  })
  try {
    await expect.poll(() => clients.windows().length, { timeout: 30_000 }).toBe(PARTICIPANTS)
    for (const page of clients.windows()) {
      await expect
        .poll(() => page.evaluate(() => window.loadError ?? (window.loadClient ? 'ok' : '')), {
          timeout: 60_000,
        })
        .toBe('ok')
    }
    await expect(host.page.getByRole('heading', { name: 'Нагрузка' })).toBeVisible()
    await host.page.waitForTimeout(WARM_UP_MS)

    const hostPid = await host.app.evaluate(
      ({ app }) =>
        app.getAppMetrics().find((m) => m.type === 'Utility' && m.name === 'Ratatosk Host')?.pid,
    )
    if (hostPid === undefined) throw new Error('no host process')
    const tree = processTree(hostPid)
    const usage = () => tree.map((pid) => processUsage(pid))
    const sum = (list: { cpuSeconds: number; rssBytes: number }[]) =>
      list.reduce(
        (a, b) => ({ cpuSeconds: a.cpuSeconds + b.cpuSeconds, rssBytes: a.rssBytes + b.rssBytes }),
        {
          cpuSeconds: 0,
          rssBytes: 0,
        },
      )
    const stats = () =>
      Promise.all(
        clients.windows().map((page) =>
          page.evaluate(() => {
            if (!window.loadClient) throw new Error('participant not ready')
            return window.loadClient.stats()
          }),
        ),
      )
    // The organizer's own app as a participant (renderer, GPU, browser): a call client's cost.
    const clientCpu = () =>
      host.app.evaluate(({ app }) =>
        app
          .getAppMetrics()
          .filter((m) => m.type !== 'Utility')
          .reduce(
            (a, m) => ({
              cpu: a.cpu + m.cpu.percentCPUUsage,
              mem: a.mem + m.memory.workingSetSize,
            }),
            { cpu: 0, mem: 0 },
          ),
      )

    /** The organizer's app: jitter buffer and round trip of what it receives. */
    const appAudio = () =>
      host.page.evaluate(async () => {
        const { connections } = window as unknown as { connections: RTCPeerConnection[] }
        const out = { delay: 0, emitted: 0, rtt: 0, protocol: '' }
        for (const pc of connections) {
          const stats = [...(await pc.getStats()).values()] as Record<string, number | string>[]
          const byId = new Map(stats.map((s) => [s['id'], s]))
          for (const s of stats) {
            if (s['type'] === 'inbound-rtp' && s['kind'] === 'audio') {
              out.delay += Number(s['jitterBufferDelay'] ?? 0)
              out.emitted += Number(s['jitterBufferEmittedCount'] ?? 0)
            }
            if (s['type'] === 'transport' && s['selectedCandidatePairId']) {
              const pair = byId.get(s['selectedCandidatePairId'])
              out.rtt = Number(pair?.['currentRoundTripTime'] ?? 0)
              out.protocol = String(byId.get(pair?.['localCandidateId'] ?? '')?.['protocol'] ?? '')
            }
          }
        }
        return out
      })

    await clientCpu()
    const appAudioBefore = await appAudio()
    const startedAt = Date.now()
    const before = sum(usage())
    const statsBefore = await stats()
    const rss: number[] = []
    // Voices with a packet in the last 300 ms, at moments during the measurement.
    let maxVoices = 0
    while (Date.now() - startedAt < MEASURE_MS) {
      for (let i = 0; i < 5; i++) {
        await host.page.waitForTimeout(1000)
        maxVoices = Math.max(maxVoices, ...(await stats()).map((c) => c.voicesNow))
      }
      rss.push(sum(usage()).rssBytes)
    }
    const after = sum(usage())
    const statsAfter = await stats()
    const appClient = await clientCpu()
    const appAudioAfter = await appAudio()
    const seconds = (Date.now() - startedAt) / 1000

    const cores = cpus().length
    const hostOneCore = ((after.cpuSeconds - before.cpuSeconds) / seconds) * 100
    const hostAllCores = hostOneCore / cores
    const total = (list: ClientStats[], key: 'bytesReceived' | 'bytesSent') =>
      list.reduce((s, c) => s + c[key], 0)
    const uploadMbps =
      ((total(statsAfter, 'bytesReceived') - total(statsBefore, 'bytesReceived')) * 8) /
      seconds /
      1e6
    const downloadMbps =
      ((total(statsAfter, 'bytesSent') - total(statsBefore, 'bytesSent')) * 8) / seconds / 1e6
    // Voice latency from the one real client (the organizer's app): one way sender →
    // organizer → listener is about one round trip; plus the 20 ms packet and the jitter buffer.
    const rttMs = appAudioAfter.rtt * 1000
    const jitterMs =
      ((appAudioAfter.delay - appAudioBefore.delay) /
        Math.max(1, appAudioAfter.emitted - appAudioBefore.emitted)) *
      1000
    const voiceLatencyMs = rttMs + 20 + jitterMs
    // Voices that arrived during a window, per participant: only forwarded ones grow (#21).
    const voicesIn = (from: ClientStats[], to: ClientStats[]) =>
      to.map(
        (c, i) =>
          Object.entries(c.audioBytes).filter(
            ([ssrc, bytes]) => bytes > (from[i]?.audioBytes[ssrc] ?? 0),
          ).length,
      )
    const maxVoicesWhole = Math.max(...voicesIn(statsBefore, statsAfter))
    // The sharer is whoever sends video; everyone else must be receiving it.
    const sharer = statsAfter.findIndex(
      (c, i) => c.videoBytesSent > (statsBefore[i]?.videoBytesSent ?? 0),
    )
    const screenFrames =
      sharer >= 0 &&
      statsAfter.every(
        (c, i) => i === sharer || c.videoFramesDecoded > (statsBefore[i]?.videoFramesDecoded ?? 0),
      )
    const protocols = [...new Set(statsAfter.map((c) => c.protocol))].join(', ')
    const peakRssMb = Math.max(...rss) / 1024 / 1024
    const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim()

    const verdict = (ok: boolean) => (ok ? '✅' : '❌')
    const report = `# Нагрузочный тест: 15 участников и одна демонстрация

Сгенерировано \`pnpm perf:load\` (PLAN #33), ${new Date().toISOString().slice(0, 10)}, коммит \`${commit}\`.

## Машина
- ${cpus()[0]?.model ?? 'CPU'}, ${cores} ядер, ${fmt(totalmem() / 1024 ** 3, 0)} ГБ, ${platform()} ${release()}
- Организатор — настоящее приложение Ratatosk; он же 15-й участник (через свой интерфейс).
- 14 участников — один отдельный Electron, по скрытому окну на каждого: тот же код звонка (\`Call\`), фейковый микрофон Chromium. Участник 1 показывает фейковое видео 1080p как экран (режим «Плавно», simulcast).
- Все на одной машине, медиа по ${protocols || 'UDP'} через адрес ${mediaHost}. Замер ${fmt(seconds, 0)} с после ${WARM_UP_MS / 1000} с разгона.

## Результаты против бюджетов (PLAN §6)

| Что | Бюджет | Получилось | |
|---|---|---|---|
| CPU сервера комнаты организатора (процесс host + mediasoup-worker), % всех ядер | ≤ 10 % на 4-ядерном ПК | ${fmt(hostAllCores)} % (${fmt(hostOneCore)} % одного ядра; на 4 ядрах было бы ≈ ${fmt(hostOneCore / 4)} %) | ${verdict(hostOneCore / 4 <= 10)} |
| RAM сервера комнаты (пик) | — | ${fmt(peakRssMb, 0)} МБ | |
| Исходящий трафик организатора | ориентир PLAN §2: голос ≈ 2 Мбит/с, экран 1080p на 14 ≈ 40 Мбит/с | ${fmt(uploadMbps)} Мбит/с | |
| Входящий трафик организатора | — | ${fmt(downloadMbps)} Мбит/с | |
| Голосов у одного участника одновременно (пакет за последние 300 мс, замер каждую секунду) | ≤ 3 (#21) | ${maxVoices} | ${verdict(maxVoices <= 3)} |
| Голосов у одного участника за весь замер (все 15 говорят без пауз) | 3 — без перещёлкивания | ${maxVoicesWhole} | ${verdict(maxVoicesWhole <= 3)} |
| Экран доходит до всех 14 зрителей | — | ${screenFrames ? 'да' : 'нет'} | ${verdict(screenFrames)} |
| Задержка голоса у приложения организатора (оценка: RTT + пакет 20 мс + буфер джиттера) | ≤ 150 мс в пределах страны | ${fmt(voiceLatencyMs, 0)} мс (RTT ${fmt(rttMs, 0)} мс по ${appAudioAfter.protocol.toUpperCase() || '?'}, буфер ${fmt(jitterMs, 0)} мс) | ${verdict(voiceLatencyMs <= 150)} |
| Приложение организатора как участник (окно, GPU, основной процесс), CPU | клиент ≤ 5 % (#34) | ${fmt(appClient.cpu)} % одного ядра, ${fmt(appClient.mem / 1024, 0)} МБ | справочно |

## Как читать
- **CPU** считается по процессорному времени процессов из ОС, а не по моментальным снимкам. «% всех ядер» — как в диспетчере задач; бюджет задан для 4-ядерного ПК, поэтому дан и пересчёт на 4 ядра.
- **Трафик** — сумма того, что получили и отправили 14 участников, то есть отдача и приём организатора без 15-го участника (он на той же машине).
- **Задержка** считается у приложения организатора — единственного настоящего клиента в этой комнате (14 тестовых окон проигрывают 42 потока через одно аудиоустройство, и их буфер джиттера не показателен). На одной машине она почти целиком состоит из буфера джиттера и пакетизации; по сети добавится время в пути. Это оценка, а не замер с общими часами.
- Клиентский бюджет (CPU ≤ 5 %, RAM ≤ 250 МБ) и холодный старт проверяются в #34 на отдельном клиенте; строка выше — справочно, у организатора в этот момент декодируется экран.
- **Фейковые данные не равны реальным:** микрофон Chromium пищит короткими сигналами раз в секунду (все 15 «говорят» одновременно — худший случай для выбора трёх голосов), а фейковое видео почти не меняется и сжимается в сотни кбит/с. Поэтому исходящий трафик здесь мал; на реальном экране 1080p ориентир PLAN §2 — ≈ 40 Мбит/с на 14 зрителей, это проверяется вручную в #34.
`
    writeFileSync(join(__dirname, '../docs/perf/load-15.md'), report)
    console.log(report)
    expect(maxVoices).toBeLessThanOrEqual(3)
    expect(screenFrames).toBe(true)
  } finally {
    await clients.close()
    await host.app.close()
  }
})
