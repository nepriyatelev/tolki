import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/** CPU seconds a process has used so far, and its resident memory in bytes. */
export interface ProcessUsage {
  cpuSeconds: number
  rssBytes: number
}

/** Seconds from ps' cputime: "1:23.45", "12:01:23.45" (macOS) or "00:01:23" (Linux). */
export function parseCpuTime(text: string): number {
  return text
    .trim()
    .split(':')
    .reduce((total, part) => total * 60 + Number(part.replace(',', '.')), 0)
}

export function processUsage(pid: number): ProcessUsage {
  const rssKb = Number(
    execFileSync('ps', ['-o', 'rss=', '-p', String(pid)])
      .toString()
      .trim(),
  )
  if (process.platform === 'linux') {
    // utime + stime in clock ticks (100 per second on Linux).
    const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]?.split(' ') ?? []
    const ticks = Number(fields[11]) + Number(fields[12])
    return { cpuSeconds: ticks / 100, rssBytes: rssKb * 1024 }
  }
  const cputime = execFileSync('ps', ['-o', 'cputime=', '-p', String(pid)]).toString()
  return { cpuSeconds: parseCpuTime(cputime), rssBytes: rssKb * 1024 }
}

/** A process and everything it started (the host and its mediasoup-worker). */
export function processTree(root: number): number[] {
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=']).toString().trim().split('\n')
  const children = new Map<number, number[]>()
  for (const row of rows) {
    const [pid, ppid] = row.trim().split(/\s+/).map(Number)
    if (pid === undefined || ppid === undefined) continue
    children.set(ppid, [...(children.get(ppid) ?? []), pid])
  }
  const tree: number[] = []
  const walk = (pid: number): void => {
    tree.push(pid)
    for (const child of children.get(pid) ?? []) walk(child)
  }
  walk(root)
  return tree
}

/** "60M", "7041K+", "1.2G-" from top's MEM column, in bytes. */
export function parseTopMemory(text: string): number {
  const match = /^([\d.]+)([BKMG])?/.exec(text.trim())
  if (!match) return 0
  const units = { B: 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3 }
  return Number(match[1]) * units[(match[2] ?? 'B') as keyof typeof units]
}

/**
 * Memory the processes really own, as the system monitor shows it: the physical footprint on
 * macOS (Activity Monitor's «Память»), PSS on Linux. Unlike the working set (RSS), the shared
 * Electron framework pages mapped by every process count once, not in each.
 */
export function footprintBytes(pids: number[]): number {
  if (process.platform === 'linux') {
    return pids.reduce((sum, pid) => {
      const pss = /^Pss:\s+(\d+) kB/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'))
      return sum + Number(pss?.[1] ?? 0) * 1024
    }, 0)
  }
  const out = execFileSync('top', [
    '-l',
    '1',
    ...pids.flatMap((pid) => ['-pid', String(pid)]),
    '-stats',
    'pid,mem',
  ])
    .toString()
    .trim()
    .split('\n')
  return out.reduce((sum, row) => {
    const [pid, mem] = row.trim().split(/\s+/)
    return pids.includes(Number(pid)) && mem ? sum + parseTopMemory(mem) : sum
  }, 0)
}
