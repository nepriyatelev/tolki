import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import log from 'electron-log/main'
import { logText, type LogPrivacy } from './log-privacy'

/** Who wrote a line: the main process, the window, or the room (host utility process). */
export type LogSource = 'main' | 'renderer' | 'host'
export const LOG_SOURCES: LogSource[] = ['main', 'renderer', 'host']

/** About 1 MB per file plus the previous one (`.old.log`): electron-log's own rotation (#106). */
export const LOG_FILE_MAX_BYTES = 1024 ** 2

export type Logger = Pick<typeof log, 'error' | 'warn' | 'info'>

/** Where the files of a source live: `<userData>/logs/<source>.log` and `<source>.old.log`. */
export function logFiles(dir: string, source: LogSource): string[] {
  return [join(dir, `${source}.old.log`), join(dir, `${source}.log`)]
}

/**
 * One electron-log instance per source, writing only to its file (and the terminal in
 * development). Every line passes through LogPrivacy before it is written.
 */
export function createLoggers(options: {
  dir: string
  privacy: LogPrivacy
  console: boolean
}): Record<LogSource, Logger> {
  const make = (source: LogSource): Logger => {
    const logger = source === 'main' ? log : log.create({ logId: source })
    logger.transports.file.resolvePathFn = () => join(options.dir, `${source}.log`)
    logger.transports.file.maxSize = LOG_FILE_MAX_BYTES
    logger.transports.file.level = 'info'
    logger.transports.console.level = options.console ? 'info' : false
    logger.hooks.push((message) => {
      message.data = message.data.map((value) => options.privacy.redact(logText(value)))
      return message
    })
    return logger
  }
  return { main: make('main'), renderer: make('renderer'), host: make('host') }
}

const TIMESTAMP = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\]/

/**
 * The files of every source as one text, line by line in time order, each tagged with its
 * source. A line without a timestamp (a stack trace) stays with the line before it.
 */
export function mergeLogs(sources: { source: LogSource; text: string }[]): string {
  const entries: { time: string; order: number; text: string }[] = []
  let order = 0
  for (const { source, text } of sources) {
    let current: { time: string; order: number; text: string } | null = null
    for (const line of text.split(/\r?\n/)) {
      if (line === '') continue
      const time = TIMESTAMP.exec(line)?.[1]
      if (time !== undefined) {
        current = { time, order: order++, text: line.replace(TIMESTAMP, `[$1] [${source}]`) }
        entries.push(current)
      } else if (current) {
        current.text += `\n${line}`
      }
    }
  }
  entries.sort((a, b) => (a.time === b.time ? a.order - b.order : a.time < b.time ? -1 : 1))
  return entries.map((e) => e.text).join('\n')
}

/** Reads every log file there is (old before current) for «Сохранить логи…». */
export async function readLogs(dir: string): Promise<{ source: LogSource; text: string }[]> {
  const out: { source: LogSource; text: string }[] = []
  for (const source of LOG_SOURCES) {
    for (const file of logFiles(dir, source)) {
      const text = await readFile(file, 'utf8').catch(() => '')
      if (text) out.push({ source, text })
    }
  }
  return out
}

/** «tolki-logs-2026-10-18-1345.txt» */
export function savedLogName(date: Date): string {
  const two = (n: number): string => String(n).padStart(2, '0')
  return `tolki-logs-${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}.txt`
}

/** Lines from a child process's stdout/stderr, whole lines only, into a logger. */
export function lineWriter(write: (line: string) => void): (chunk: Buffer | string) => void {
  let rest = ''
  return (chunk) => {
    const lines = (rest + chunk.toString()).split(/\r?\n/)
    rest = lines.pop() ?? ''
    for (const line of lines) if (line.trim() !== '') write(line)
  }
}
