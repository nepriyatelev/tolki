/**
 * What may go into the logs (#106): everything is redacted on its way into a file, like Signal's
 * `redactAll`. Addresses keep their kind and a tail, invite links and secrets disappear, names
 * become pseudonyms for the session. Structured log events already avoid personal data; this is
 * the safety net for error messages and anything else.
 */

import { peerAlias, roomAlias } from '@shared/log-alias'

export { peerAlias, roomAlias }

/** Kind of address plus a mask: enough to tell networks apart, not enough to find anyone. */
export function maskIpv4(a: number, b: number, c: number, d: number): string {
  if (a === 127 || (a === 0 && b === 0 && c === 0 && d === 0)) return `${a}.${b}.${c}.${d}`
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
    return `частный ${a}.${b}.x.x`
  }
  if (a === 100 && b >= 64 && b <= 127) return `CGNAT 100.x.x.${d}`
  if (a === 169 && b === 254) return 'локальный 169.254.x.x'
  // Benchmarking range, used by VPN clients for their tunnel (Shadowrocket and others).
  if (a === 198 && (b === 18 || b === 19)) return `служебный 198.${b}.x.x`
  return `публичный ${a}.x.x.${d}`
}

function maskIpv6(text: string): string {
  const groups = text.split(':').filter((g) => g !== '')
  if (groups.length === 0 || text === '::1') return text
  const first = groups[0] ?? ''
  const last = groups[groups.length - 1] ?? ''
  return `${first.toLowerCase().startsWith('fe80') ? 'локальный ' : ''}${first}:…:${last}`
}

const IPV4 = /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d.])/g
const IPV6 = /(?<![\w:.])((?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4})(?![\w:])/gi
const INVITE_LINK = /tolki:\/\/\S+/gi
/** A SHA-256 certificate fingerprint in base64url (43 characters). */
const FINGERPRINT = /(?<![\w-])[A-Za-z0-9_-]{43}(?![\w-])/g
const SECRET_FIELD = /("(?:password|hmac|nonce)"\s*:\s*)"[^"]*"/gi
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface LogPrivacyOptions {
  /** The user's home folder: paths show it as «~». */
  home?: string
}

/**
 * Redacts a log line. Known names and the room password (registered while the app runs) are
 * replaced first, then addresses, links, fingerprints and the home folder.
 */
export class LogPrivacy {
  /** Exact strings that must not reach a file, and what to write instead. */
  readonly #secrets = new Map<string, string>()

  constructor(private readonly options: LogPrivacyOptions = {}) {}

  /** A participant's name: replaced by their pseudonym. */
  addPeer(peerId: string, name: string, self = false): void {
    this.#add(name, self ? `я (${peerAlias(peerId)})` : peerAlias(peerId))
  }

  /** The user's own name before a peer id is known. */
  addOwnName(name: string): void {
    if (![...this.#secrets.values()].some((v) => v.startsWith('я'))) this.#add(name, 'я')
  }

  addRoom(roomId: string, name: string): void {
    this.#add(name, roomAlias(roomId))
  }

  addPassword(password: string): void {
    this.#add(password, '[пароль]')
  }

  #add(secret: string, replacement: string): void {
    const value = secret.trim()
    if (value.length > 0) this.#secrets.set(value, replacement)
  }

  redact(text: string): string {
    let out = text
    // Longest first: «Комната у Димы» before «Димы».
    for (const [secret, replacement] of [...this.#secrets].sort(
      (a, b) => b[0].length - a[0].length,
    )) {
      out = this.#replaceSecret(out, secret, replacement)
    }
    out = out.replace(INVITE_LINK, '[ссылка-приглашение]')
    out = out.replace(SECRET_FIELD, '$1"[скрыто]"')
    out = out.replace(FINGERPRINT, (fp) => `${fp.slice(0, 6)}…`)
    out = out.replace(IPV6, (match) =>
      match.includes('::') || match.split(':').length === 8 ? maskIpv6(match) : match,
    )
    out = out.replace(IPV4, (match, a: string, b: string, c: string, d: string) => {
      const octets = [a, b, c, d].map(Number)
      if (octets.some((o) => o > 255)) return match
      return maskIpv4(octets[0] ?? 0, octets[1] ?? 0, octets[2] ?? 0, octets[3] ?? 0)
    })
    const home = this.options.home
    if (home && home.length > 1) out = out.split(home).join('~')
    return out
  }

  /**
   * Long secrets go wherever they appear; short ones only as whole words, so a name like «Ян»
   * does not eat into every word that contains it.
   */
  #replaceSecret(text: string, secret: string, replacement: string): string {
    if (secret.length >= 6) return text.split(secret).join(replacement)
    const pattern = new RegExp(escapeRegExp(secret), 'gu')
    return text.replace(pattern, (match, offset: number) => {
      const before = text[offset - 1] ?? ''
      const after = text[offset + match.length] ?? ''
      return LETTER_OR_DIGIT.test(before) || LETTER_OR_DIGIT.test(after) ? match : replacement
    })
  }
}

/** Any value as a log string: errors with their stack, objects as JSON. */
export function logText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
