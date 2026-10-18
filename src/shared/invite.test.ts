import { describe, expect, it } from 'vitest'
import {
  buildInvite,
  inviteAddress,
  inviteErrorMessage,
  parseInvite,
  type Invite,
  type InviteError,
} from './invite'

const FP = '2_SqXt3l45Ay59VWqBcvcLmeh7BmqvL0m-UwbNw3EiE'
const BASE: Invite = {
  host: '203.0.113.5',
  hostKind: 'ipv4',
  port: 47000,
  roomId: 'vecherniy',
  fingerprint: FP,
}
const LINK = `tolki://join?v=1&h=203.0.113.5&p=47000&r=vecherniy&fp=${FP}`

function error(link: string): InviteError | null {
  const result = parseInvite(link)
  return result.ok ? null : result.error
}

describe('buildInvite', () => {
  it('builds the link from the plan, parameters in order', () => {
    expect(buildInvite(BASE)).toBe(LINK)
  })

  it('adds the password only when given, URL-encoded', () => {
    expect(buildInvite({ ...BASE, password: 'лиса-маяк 42+&=' })).toBe(
      `${LINK}&k=%D0%BB%D0%B8%D1%81%D0%B0-%D0%BC%D0%B0%D1%8F%D0%BA+42%2B%26%3D`,
    )
  })

  it('puts IPv6 in brackets and normalises it', () => {
    expect(buildInvite({ ...BASE, host: '2001:DB8:0:0::1', hostKind: 'ipv6' })).toContain(
      'h=%5B2001%3Adb8%3A%3A1%5D',
    )
  })

  it('lower-cases DNS names', () => {
    expect(buildInvite({ ...BASE, host: 'Alexey.DDNS.net', hostKind: 'dns' })).toContain(
      'h=alexey.ddns.net',
    )
  })

  it.each<[string, Partial<Invite>]>([
    ['host', { host: '1.2.3' }],
    ['host kind', { host: 'example.com', hostKind: 'ipv4' }],
    ['port', { port: 0 }],
    ['port', { port: 65536 }],
    ['room id', { roomId: 'комната' }],
    ['fingerprint', { fingerprint: 'abc' }],
    ['password', { password: '' }],
  ])('refuses to build with an invalid %s', (_field, patch) => {
    expect(() => buildInvite({ ...BASE, ...patch })).toThrow()
  })
})

describe('parseInvite', () => {
  it('parses a valid link', () => {
    expect(parseInvite(LINK)).toEqual({ ok: true, invite: { ...BASE, password: undefined } })
  })

  it.each<[string, Invite]>([
    ['IPv4', BASE],
    ['IPv6', { ...BASE, host: '2a02:6b8::feed:ff', hostKind: 'ipv6' }],
    ['IPv4-mapped IPv6', { ...BASE, host: '::ffff:102:304', hostKind: 'ipv6' }],
    ['DNS name', { ...BASE, host: 'alexey.ddns.net', hostKind: 'dns' }],
    ['single-label name', { ...BASE, host: 'alexey-mac', hostKind: 'dns' }],
    ['punycode name', { ...BASE, host: 'xn--e1afmkfd.xn--p1ai', hostKind: 'dns' }],
    ['password', { ...BASE, password: 'лиса-маяк-42' }],
    ['password with URL characters', { ...BASE, password: 'a+b&c=d/e?f#g%h' }],
    ['lowest port', { ...BASE, port: 1 }],
    ['highest port', { ...BASE, port: 65535 }],
  ])('round-trips a link with %s', (_case, invite) => {
    expect(parseInvite(buildInvite(invite))).toEqual({
      ok: true,
      invite: { ...invite, password: invite.password },
    })
  })

  it('accepts IPv6 written in any valid form and normalises it', () => {
    const result = parseInvite(LINK.replace('h=203.0.113.5', 'h=[2001:0DB8:0000::0001]'))

    expect(result).toMatchObject({ ok: true, invite: { host: '2001:db8::1', hostKind: 'ipv6' } })
  })

  it('tolerates surrounding whitespace, a trailing slash and an upper-case scheme', () => {
    expect(parseInvite(`  ${LINK}\n`).ok).toBe(true)
    expect(parseInvite(LINK.replace('join?', 'join/?')).ok).toBe(true)
    expect(parseInvite(LINK.replace('tolki://join', 'TOLKI://JOIN')).ok).toBe(true)
  })

  describe('rejects links that are not invites', () => {
    it.each([
      '',
      'hello',
      'https://tolki.app/join?v=1',
      'tolki://room?v=1',
      'tolki://join/extra?v=1',
      'tolki://user:pw@join?v=1',
      `${LINK}#fragment`,
      `${LINK}&k=${'x'.repeat(2100)}`,
    ])('%s', (link) => {
      expect(error(link)).toEqual({ code: 'not-an-invite' })
    })
  })

  it('asks to update the app for a newer link version', () => {
    expect(error(LINK.replace('v=1', 'v=2'))).toEqual({ code: 'unsupported-version', param: 'v' })
  })

  it('checks the version before other parameters a newer app might add', () => {
    expect(error('tolki://join?v=3&x=new')).toEqual({ code: 'unknown-param', param: 'x' })
    expect(error('tolki://join?v=3')).toEqual({ code: 'unsupported-version', param: 'v' })
  })

  it.each([
    ['v', 'tolki://join?h=1.2.3.4'],
    ['h', LINK.replace('h=203.0.113.5&', '')],
    ['p', LINK.replace('p=47000&', '')],
    ['r', LINK.replace('r=vecherniy&', '')],
    ['fp', LINK.replace(`&fp=${FP}`, '')],
  ])('reports a missing %s', (param, link) => {
    expect(error(link)).toEqual({ code: 'missing-param', param })
  })

  it('rejects unknown and repeated parameters', () => {
    expect(error(`${LINK}&utm_source=x`)).toEqual({ code: 'unknown-param', param: 'utm_source' })
    expect(error(`${LINK}&p=1`)).toEqual({ code: 'duplicate-param', param: 'p' })
  })

  it.each(['0', '01', 'one', '1.0', '-1', '99999'])('rejects version "%s"', (v) => {
    expect(error(LINK.replace('v=1', `v=${v}`))).toEqual({ code: 'invalid-version', param: 'v' })
  })

  describe('rejects invalid hosts', () => {
    it.each([
      '',
      '1.2.3',
      '1.2.3.256',
      '01.2.3.4',
      '0x7f.0.0.1',
      '1.2.3.4.5',
      '2001:db8::1',
      '[1.2.3.4]',
      '[2001:db8::1',
      '[1:2:3]',
      '[fe80::1%25en0]',
      'пример.рф',
      'a_b.com',
      '-bad.com',
      'bad-.com',
      'a..b',
      `${'a'.repeat(64)}.com`,
      `${'abc.'.repeat(64)}com`,
      'host:47000',
      'evil.com/path',
    ])('%s', (host) => {
      expect(error(LINK.replace('h=203.0.113.5', `h=${encodeURIComponent(host)}`))).toEqual({
        code: 'invalid-host',
        param: 'h',
      })
    })
  })

  it.each(['0', '65536', '047000', '+47000', '47000.0', '', 'http'])(
    'rejects port "%s"',
    (port) => {
      expect(error(LINK.replace('p=47000', `p=${port}`))).toEqual({
        code: 'invalid-port',
        param: 'p',
      })
    },
  )

  it.each(['', 'комната', 'a b', 'a.b', 'x'.repeat(65)])('rejects room id "%s"', (room) => {
    expect(error(LINK.replace('r=vecherniy', `r=${encodeURIComponent(room)}`))).toEqual({
      code: 'invalid-room',
      param: 'r',
    })
  })

  it.each([
    ['too short', FP.slice(0, 42)],
    ['too long', `${FP}A`],
    ['padded base64', `${FP.slice(0, 42)}E=`],
    ['standard base64 alphabet', `${FP.slice(0, 41)}+E`],
    ['impossible last character', `${FP.slice(0, 42)}F`],
  ])('rejects a fingerprint that is %s', (_case, fp) => {
    expect(error(LINK.replace(FP, encodeURIComponent(fp)))).toEqual({
      code: 'invalid-fingerprint',
      param: 'fp',
    })
  })

  it.each([
    ['empty', ''],
    ['too long', 'x'.repeat(129)],
    ['with control characters', 'pass\nword'],
  ])('rejects a password that is %s', (_case, password) => {
    expect(error(`${LINK}&k=${encodeURIComponent(password)}`)).toEqual({
      code: 'invalid-password',
      param: 'k',
    })
  })
})

describe('inviteErrorMessage', () => {
  it('tells the user to update the app for newer links', () => {
    expect(inviteErrorMessage({ code: 'unsupported-version' })).toContain('Нужна последняя версия')
  })

  it('explains links that are not invites', () => {
    expect(inviteErrorMessage({ code: 'not-an-invite' })).toBe('Это не ссылка-приглашение Tolki.')
  })

  it('asks for a fresh link when it is damaged', () => {
    expect(inviteErrorMessage({ code: 'invalid-port', param: 'p' })).toContain(
      'Ссылка-приглашение повреждена',
    )
  })
})

describe('inviteAddress', () => {
  it('formats host and port, with IPv6 in brackets', () => {
    expect(inviteAddress(BASE)).toBe('203.0.113.5:47000')
    expect(inviteAddress({ host: '2a02:6b8::1', hostKind: 'ipv6', port: 1 })).toBe(
      '[2a02:6b8::1]:1',
    )
    expect(inviteAddress({ host: 'alexey.ddns.net', hostKind: 'dns', port: 47000 })).toBe(
      'alexey.ddns.net:47000',
    )
  })
})
