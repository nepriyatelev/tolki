/**
 * Invite links (PLAN §5):
 *   tolki://join?v=1&h=<host>&p=<port>&r=<roomId>&fp=<sha256 base64url>[&k=<password>]
 *
 * The parser is strict: anything it does not fully understand is rejected, so a damaged or
 * tampered link never connects somewhere unexpected.
 */

export const INVITE_VERSION = 1
export const INVITE_SCHEME = 'tolki:'

const MAX_LINK_LENGTH = 2048
const MAX_PASSWORD_LENGTH = 128
const ROOM_ID = /^[A-Za-z0-9_-]{1,64}$/
/** 32 bytes in unpadded base64url: 43 chars, the last one carries only 4 bits. */
const FINGERPRINT = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/
const PARAMS = ['v', 'h', 'p', 'r', 'fp', 'k'] as const

export type InviteHostKind = 'ipv4' | 'ipv6' | 'dns'

export interface Invite {
  /** IPv6 without brackets, DNS names in lower case. */
  host: string
  hostKind: InviteHostKind
  port: number
  roomId: string
  fingerprint: string
  /** Present only if the host chose to embed the password in the link. */
  password?: string | undefined
}

export type InviteErrorCode =
  | 'not-an-invite'
  | 'unsupported-version'
  | 'missing-param'
  | 'unknown-param'
  | 'duplicate-param'
  | 'invalid-version'
  | 'invalid-host'
  | 'invalid-port'
  | 'invalid-room'
  | 'invalid-fingerprint'
  | 'invalid-password'

export interface InviteError {
  code: InviteErrorCode
  /** The query parameter at fault, when there is one. */
  param?: string
}

export type InviteParseResult = { ok: true; invite: Invite } | { ok: false; error: InviteError }

export function buildInvite(invite: Invite): string {
  const host = parseHost(invite.hostKind === 'ipv6' ? `[${invite.host}]` : invite.host)
  if (!host || host.kind !== invite.hostKind) throw new Error(`Invalid invite host: ${invite.host}`)
  if (!isPort(invite.port)) throw new Error(`Invalid invite port: ${invite.port}`)
  if (!ROOM_ID.test(invite.roomId)) throw new Error('Invalid invite room id')
  if (!FINGERPRINT.test(invite.fingerprint)) throw new Error('Invalid invite fingerprint')
  if (invite.password !== undefined && !isPassword(invite.password)) {
    throw new Error('Invalid invite password')
  }

  const params = new URLSearchParams()
  params.set('v', String(INVITE_VERSION))
  params.set('h', host.kind === 'ipv6' ? `[${host.value}]` : host.value)
  params.set('p', String(invite.port))
  params.set('r', invite.roomId)
  params.set('fp', invite.fingerprint)
  if (invite.password !== undefined) params.set('k', invite.password)
  return `tolki://join?${params.toString()}`
}

export function parseInvite(link: string): InviteParseResult {
  const fail = (code: InviteErrorCode, param?: string): InviteParseResult => ({
    ok: false,
    error: param === undefined ? { code } : { code, param },
  })

  const text = link.trim()
  if (text.length > MAX_LINK_LENGTH) return fail('not-an-invite')
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return fail('not-an-invite')
  }
  // Some systems append "/" when handing a custom-scheme link to the app.
  if (
    url.protocol !== INVITE_SCHEME ||
    url.host.toLowerCase() !== 'join' ||
    (url.pathname !== '' && url.pathname !== '/') ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== ''
  ) {
    return fail('not-an-invite')
  }

  const values = new Map<string, string>()
  for (const [key, value] of url.searchParams) {
    if (!(PARAMS as readonly string[]).includes(key)) return fail('unknown-param', key)
    if (values.has(key)) return fail('duplicate-param', key)
    values.set(key, value)
  }

  // Version first: a newer app may use parameters this one does not know.
  const version = values.get('v')
  if (version === undefined) return fail('missing-param', 'v')
  if (!/^[1-9]\d{0,3}$/.test(version)) return fail('invalid-version', 'v')
  if (Number(version) !== INVITE_VERSION) return fail('unsupported-version', 'v')

  const hostText = values.get('h')
  if (hostText === undefined) return fail('missing-param', 'h')
  const host = parseHost(hostText)
  if (!host) return fail('invalid-host', 'h')

  const portText = values.get('p')
  if (portText === undefined) return fail('missing-param', 'p')
  const port = /^[1-9]\d{0,4}$/.test(portText) ? Number(portText) : NaN
  if (!isPort(port)) return fail('invalid-port', 'p')

  const roomId = values.get('r')
  if (roomId === undefined) return fail('missing-param', 'r')
  if (!ROOM_ID.test(roomId)) return fail('invalid-room', 'r')

  const fingerprint = values.get('fp')
  if (fingerprint === undefined) return fail('missing-param', 'fp')
  if (!FINGERPRINT.test(fingerprint)) return fail('invalid-fingerprint', 'fp')

  const password = values.get('k')
  if (password !== undefined && !isPassword(password)) return fail('invalid-password', 'k')

  return {
    ok: true,
    invite: { host: host.value, hostKind: host.kind, port, roomId, fingerprint, password },
  }
}

/** "203.0.113.5:47000", "[2a02:6b8::1]:47000", "alexey.ddns.net:47000" */
export function inviteAddress(invite: Pick<Invite, 'host' | 'hostKind' | 'port'>): string {
  const host = invite.hostKind === 'ipv6' ? `[${invite.host}]` : invite.host
  return `${host}:${invite.port}`
}

/** Plain-words explanation for the join screen and deep-link errors. */
export function inviteErrorMessage(error: InviteError): string {
  switch (error.code) {
    case 'unsupported-version':
      return 'Ссылка создана в более новой версии Tolki. Нужна последняя версия приложения.'
    case 'not-an-invite':
      return 'Это не ссылка-приглашение Tolki.'
    default:
      return 'Ссылка-приглашение повреждена. Нужна новая ссылка от организатора.'
  }
}

function isPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535
}

// eslint-disable-next-line no-control-regex -- control characters are exactly what we reject
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

function isPassword(password: string): boolean {
  return (
    password.length >= 1 && password.length <= MAX_PASSWORD_LENGTH && !CONTROL_CHARS.test(password)
  )
}

const IPV4_OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
const IPV4 = new RegExp(`^${IPV4_OCTET}(\\.${IPV4_OCTET}){3}$`)
const DNS_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/

function parseHost(raw: string): { kind: InviteHostKind; value: string } | null {
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1)
    // Zone ids (fe80::1%en0) only make sense on one machine; URL rejects them too.
    if (!inner.includes(':') || inner.includes('%')) return null
    try {
      return { kind: 'ipv6', value: new URL(`http://[${inner}]/`).hostname.slice(1, -1) }
    } catch {
      return null
    }
  }
  if (IPV4.test(raw)) return { kind: 'ipv4', value: raw }

  const name = raw.toLowerCase()
  if (
    name.length > 253 ||
    !name.split('.').every((label) => DNS_LABEL.test(label)) ||
    // An all-numeric last label is a broken IPv4 ("1.2.3"), not a domain.
    /(^|\.)\d+$/.test(name)
  ) {
    return null
  }
  return { kind: 'dns', value: name }
}
