import { describe, expect, it } from 'vitest'
import type { HostingVerdict, NetworkCheckResult } from '@shared/network'
import { PUBLIC_IPV4_CHECK } from '../../../test/tolki-mock'
import { describeHosting } from './hosting-status'

function withVerdict(
  verdict: HostingVerdict,
  ipv6Address: string | null = null,
): NetworkCheckResult {
  return { ...PUBLIC_IPV4_CHECK, verdict, ipv6Address }
}

describe('describeHosting', () => {
  it('says hosting works and shows the method and external address', () => {
    expect(describeHosting(PUBLIC_IPV4_CHECK)).toEqual({
      tone: 'ok',
      title: 'Этот компьютер может быть организатором: порт открыт через UPnP',
      details: ['Внешний адрес 93.184.216.34'],
    })
  })

  it('shows the external port when the router picked another one, and IPv6', () => {
    const result = withVerdict(
      {
        canHost: true,
        via: 'ipv4',
        method: 'pcp',
        externalAddress: '93.184.216.34',
        externalPort: 51000,
      },
      '2a02:6b8::1',
    )

    expect(describeHosting(result).details).toEqual([
      'Внешний адрес 93.184.216.34:51000',
      'IPv6 доступен',
    ])
  })

  it('explains IPv6-only hosting', () => {
    const result = withVerdict(
      { canHost: true, via: 'ipv6', address: '2a02:6b8::1', ipv4Problem: 'cgnat' },
      '2a02:6b8::1',
    )

    expect(describeHosting(result)).toEqual({
      tone: 'ok',
      title: 'Этот компьютер может быть организатором через IPv6',
      details: ['По IPv4 нельзя: провайдер выдаёт общий адрес (CGNAT)'],
    })
  })

  it.each([
    ['cgnat', 'провайдер выдаёт общий адрес (CGNAT)', 'белый IP'],
    ['double-nat', 'двойной NAT', 'режим моста'],
    ['no-gateway', 'не найден роутер', 'VPN'],
    ['unsupported', 'не открывает порты автоматически', 'порта 47000 вручную'],
    ['refused', 'отказался открыть порт', 'порта 47000 вручную'],
    ['mapping-disabled', 'проброс порта выключен', 'Порт 47000'],
  ] as const)('explains "%s" in plain words with advice', (problem, title, advice) => {
    const text = describeHosting(withVerdict({ canHost: false, problem }))

    expect(text.tone).toBe('bad')
    expect(text.title).toContain('Этот компьютер не может быть организатором')
    expect(text.title).toContain(title)
    expect(text.details[0]).toContain(advice)
  })

  it('a port forwarded by hand, and a port closed from outside (#128)', () => {
    expect(
      describeHosting(
        withVerdict({
          canHost: true,
          via: 'ipv4',
          method: 'manual',
          externalAddress: '93.184.216.34',
          externalPort: 47000,
        }),
      ).title,
    ).toBe('Этот компьютер может быть организатором: порт открыт через проброс вручную')
    const closed = describeHosting(withVerdict({ canHost: false, problem: 'closed' }))
    expect(closed.title).toBe('Этот компьютер не может быть организатором: порт закрыт снаружи')
    expect(closed.details[0]).toMatch(/UPnP или проброс порта 47000/)
  })
})
