import type { RecentRoom, RecentStatus } from '@shared/recent'
import { inviteAddress } from '@shared/invite'

const plural = new Intl.PluralRules('ru-RU')
const relative = new Intl.RelativeTimeFormat('ru-RU', { numeric: 'auto' })
const DAY_MS = 24 * 60 * 60 * 1000

function people(count: number): string {
  const form = plural.select(count)
  return `${count} ${form === 'few' ? 'человека' : 'человек'}`
}

export interface StatusText {
  tone: 'accent' | 'neutral' | 'danger'
  dot: boolean
  text: string
}

/** Status chip of a recent room: only the number of people, as PLAN #15 requires. */
export function describeRecentStatus(status: RecentStatus | undefined): StatusText {
  if (status === undefined) return { tone: 'neutral', dot: false, text: 'Проверка…' }
  switch (status.status) {
    case 'live':
      return status.peerCount === 0
        ? { tone: 'accent', dot: true, text: 'Запущена · пока никого' }
        : { tone: 'accent', dot: true, text: `Идёт · ${people(status.peerCount)}` }
    case 'offline':
      return { tone: 'neutral', dot: true, text: 'Организатор не в сети' }
    case 'certificate-changed':
      return { tone: 'danger', dot: false, text: 'Сертификат изменился' }
  }
}

/** "сегодня", "вчера", "5 дней назад" by calendar day. */
export function lastUsedText(lastUsedAt: number, now: number = Date.now()): string {
  const startOfDay = (t: number): number => {
    const d = new Date(t)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  const days = Math.round((startOfDay(now) - startOfDay(lastUsedAt)) / DAY_MS)
  return relative.format(-Math.max(0, days), 'day')
}

/** "alexey.ddns.net:47000 · пароль сохранён · вчера" */
export function recentSubtitle(room: RecentRoom, now?: number): string {
  return [
    inviteAddress(room.invite),
    ...(room.passwordSaved ? ['пароль сохранён'] : []),
    lastUsedText(room.lastUsedAt, now),
  ].join(' · ')
}
