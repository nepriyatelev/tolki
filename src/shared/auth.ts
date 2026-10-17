/**
 * Password check without sending the password (PLAN #13): the host sends a random nonce, the
 * client answers HMAC-SHA256(key = password, message = nonce + certificate fingerprint).
 *
 * The fingerprint is the one the client saw on the TLS connection, so an answer relayed through
 * someone else's certificate does not verify on the real host (channel binding).
 * WebCrypto keeps this identical in Node and in the browser.
 */

const encoder = new TextEncoder()
const CONTEXT = 'ratatosk-auth-v1'

export function newNonce(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)))
}

function hmacKey(password: string, usage: 'sign' | 'verify') {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(password.normalize('NFC')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  )
}

function authMessage(nonce: string, fingerprint: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`${CONTEXT}\n${nonce}\n${fingerprint}`)
}

export async function computeAuthHmac(
  password: string,
  nonce: string,
  fingerprint: string,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(password, 'sign'),
    authMessage(nonce, fingerprint),
  )
  return toBase64Url(new Uint8Array(signature))
}

/** Constant-time comparison is done by WebCrypto's verify. */
export async function verifyAuthHmac(
  password: string,
  nonce: string,
  fingerprint: string,
  hmac: string,
): Promise<boolean> {
  const signature = fromBase64Url(hmac)
  if (signature === null) return false
  return crypto.subtle.verify(
    'HMAC',
    await hmacKey(password, 'verify'),
    signature,
    authMessage(nonce, fingerprint),
  )
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
    return Uint8Array.from(binary, (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}
