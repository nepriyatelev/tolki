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
