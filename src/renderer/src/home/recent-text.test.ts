import { describe, expect, it } from 'vitest'
import { describeRecentStatus, lastUsedText, recentSubtitle } from './recent-text'

describe('describeRecentStatus', () => {
  it.each([
    [{ status: 'live', peerCount: 1 } as const, 'Идёт · 1 человек'],
    [{ status: 'live', peerCount: 2 } as const, 'Идёт · 2 человека'],
    [{ status: 'live', peerCount: 5 } as const, 'Идёт · 5 человек'],
    [{ status: 'live', peerCount: 0 } as const, 'Запущена · пока никого'],
    [{ status: 'offline' } as const, 'Хост не в сети'],
    [{ status: 'certificate-changed' } as const, 'Сертификат изменился'],
    [undefined, 'Проверяем…'],
  ])('%j → %s', (status, text) => {
    expect(describeRecentStatus(status).text).toBe(text)
  })
})

describe('lastUsedText', () => {
  const now = new Date(2026, 9, 17, 21, 0).getTime()

  it.each([
    [new Date(2026, 9, 17, 0, 5).getTime(), 'сегодня'],
    [new Date(2026, 9, 16, 23, 59).getTime(), 'вчера'],
    [new Date(2026, 9, 12, 12, 0).getTime(), '5 дней назад'],
  ])('%s → %s', (at, text) => {
    expect(lastUsedText(at, now)).toBe(text)
  })
})

describe('recentSubtitle', () => {
  it('shows the address, whether the password is saved and when', () => {
    const now = Date.now()
    const room = {
      id: 'x',
      invite: {
        host: 'alexey.ddns.net',
        hostKind: 'dns' as const,
        port: 47000,
        roomId: 'r',
        fingerprint: 'f',
      },
      roomName: 'Комната',
      lastUsedAt: now,
      passwordSaved: true,
    }

    expect(recentSubtitle(room, now)).toBe('alexey.ddns.net:47000 · пароль сохранён · сегодня')
    expect(recentSubtitle({ ...room, passwordSaved: false }, now)).toBe(
      'alexey.ddns.net:47000 · сегодня',
    )
  })
})
