import { describe, expect, it } from 'vitest'
import { LogPrivacy, logText, maskIpv4, peerAlias, roomAlias } from './log-privacy'

const FP = '2_SqXt3l45Ay59VWqBcvcLmeh7BmqvL0m-UwbNw3EiE'

describe('maskIpv4 (#106)', () => {
  it('keeps the kind of address and a tail', () => {
    expect(maskIpv4(93, 184, 216, 34)).toBe('публичный 93.x.x.34')
    expect(maskIpv4(192, 168, 1, 42)).toBe('частный 192.168.x.x')
    expect(maskIpv4(10, 0, 0, 5)).toBe('частный 10.0.x.x')
    expect(maskIpv4(172, 20, 1, 1)).toBe('частный 172.20.x.x')
    expect(maskIpv4(100, 72, 3, 9)).toBe('CGNAT 100.x.x.9')
    expect(maskIpv4(169, 254, 7, 7)).toBe('локальный 169.254.x.x')
    expect(maskIpv4(198, 18, 0, 1)).toBe('служебный 198.18.x.x')
  })

  it('leaves loopback and «any» as they are: they say nothing about anyone', () => {
    expect(maskIpv4(127, 0, 0, 1)).toBe('127.0.0.1')
    expect(maskIpv4(0, 0, 0, 0)).toBe('0.0.0.0')
  })
})

describe('LogPrivacy.redact (#106)', () => {
  const privacy = () => new LogPrivacy({ home: '/Users/alexey' })

  it('masks IPv4 and IPv6 addresses inside text', () => {
    const p = privacy()
    expect(p.redact('external 93.184.216.34:47000, local 192.168.1.42')).toBe(
      'external публичный 93.x.x.34:47000, local частный 192.168.x.x',
    )
    expect(p.redact('host [2a02:6b8:0:1::7f3e]:47000')).toBe('host [2a02:…:7f3e]:47000')
    expect(p.redact('via fe80::1c2b:3d4e:5f60:7182')).toBe('via локальный fe80:…:7182')
    expect(p.redact('loopback ::1 and 127.0.0.1')).toBe('loopback ::1 and 127.0.0.1')
  })

  it('does not take times, versions or ports for addresses', () => {
    const p = privacy()
    expect(p.redact('[2026-10-18 13:45:02.123] Chrome 140.0.7339.80')).toBe(
      '[2026-10-18 13:45:02.123] Chrome 140.0.7339.80',
    )
  })

  it('drops invite links, shortens fingerprints, hides secret fields', () => {
    const p = privacy()
    expect(p.redact(`link tolki://join?v=1&h=93.184.216.34&p=47000&r=room&fp=${FP}&k=pw ok`)).toBe(
      'link [ссылка-приглашение] ok',
    )
    expect(p.redact(`fingerprint ${FP}`)).toBe('fingerprint 2_SqXt…')
    expect(p.redact('{"name":"x","password":"лиса-маяк-42","hmac":"abc"}')).toBe(
      '{"name":"x","password":"[скрыто]","hmac":"[скрыто]"}',
    )
  })

  it('shows the home folder as «~»', () => {
    expect(privacy().redact('at /Users/alexey/Library/Tolki/logs/main.log')).toBe(
      'at ~/Library/Tolki/logs/main.log',
    )
  })

  it('replaces registered names, the room name and the password', () => {
    const p = privacy()
    p.addPeer('3f2a9c00-aaaa', 'Дима')
    p.addPeer('77bd0000-bbbb', 'Алексей', true)
    p.addRoom('vecherniy', 'Вечерний созвон')
    p.addPassword('лиса-маяк-42')

    expect(p.redact('Дима joined «Вечерний созвон»; Алексей talks; pw лиса-маяк-42')).toBe(
      'участник 3f2a joined «комната vech»; я (участник 77bd) talks; pw [пароль]',
    )
  })

  it('replaces a short name only as a whole word', () => {
    const p = privacy()
    p.addPeer('aaaa1111', 'Ян')
    expect(p.redact('Ян: состояние Янтарь')).toBe('участник aaaa: состояние Янтарь')
  })

  it('aliases are short and stable', () => {
    expect(peerAlias('3f2a9c00-1111')).toBe('участник 3f2a')
    expect(roomAlias('vecherniy')).toBe('комната vech')
  })
})

describe('logText', () => {
  it('turns errors and objects into text', () => {
    expect(logText('plain')).toBe('plain')
    expect(logText(new Error('boom'))).toContain('Error: boom')
    expect(logText({ a: 1 })).toBe('{"a":1}')
  })
})
