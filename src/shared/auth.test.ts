import { describe, expect, it } from 'vitest'
import { computeAuthHmac, newNonce, verifyAuthHmac } from './auth'

const FP = '2_SqXt3l45Ay59VWqBcvcLmeh7BmqvL0m-UwbNw3EiE'

describe('password HMAC', () => {
  it('verifies an answer made with the same password, nonce and fingerprint', async () => {
    const nonce = newNonce()
    const hmac = await computeAuthHmac('лиса-маяк-42', nonce, FP)

    expect(hmac).toMatch(/^[A-Za-z0-9_-]{43}$/)
    await expect(verifyAuthHmac('лиса-маяк-42', nonce, FP, hmac)).resolves.toBe(true)
  })

  it('rejects a wrong password', async () => {
    const nonce = newNonce()
    const hmac = await computeAuthHmac('wrong', nonce, FP)

    await expect(verifyAuthHmac('лиса-маяк-42', nonce, FP, hmac)).resolves.toBe(false)
  })

  it('rejects an answer replayed for another nonce', async () => {
    const hmac = await computeAuthHmac('secret', newNonce(), FP)

    await expect(verifyAuthHmac('secret', newNonce(), FP, hmac)).resolves.toBe(false)
  })

  it('rejects an answer made for another certificate (relay through a different TLS endpoint)', async () => {
    const nonce = newNonce()
    const hmac = await computeAuthHmac('secret', nonce, 'A'.repeat(43))

    await expect(verifyAuthHmac('secret', nonce, FP, hmac)).resolves.toBe(false)
  })

  it('treats composed and decomposed Unicode the same (NFC)', async () => {
    const nonce = newNonce()
    const hmac = await computeAuthHmac('ёлка', nonce, FP)

    await expect(verifyAuthHmac('ёлка', nonce, FP, hmac)).resolves.toBe(true)
  })

  it.each(['', 'not base64!', '@@@@'])('rejects malformed answer "%s"', async (hmac) => {
    await expect(verifyAuthHmac('secret', newNonce(), FP, hmac)).resolves.toBe(false)
  })

  it('makes unique 32-byte nonces', () => {
    const nonces = new Set(Array.from({ length: 50 }, newNonce))

    expect(nonces.size).toBe(50)
    for (const n of nonces) expect(n).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})
