import { X509Certificate } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CERTIFICATE_FILE, certificateFingerprint, loadOrCreateCertificate } from './certificate'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tolki-cert-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('loadOrCreateCertificate', () => {
  it('creates a long-lived P-256 certificate with a base64url SHA-256 fingerprint', async () => {
    const cert = await loadOrCreateCertificate(dir)
    const x509 = new X509Certificate(cert.cert)

    expect(cert.fingerprint).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(cert.fingerprint).toBe(certificateFingerprint(cert.cert))
    expect(x509.publicKey.asymmetricKeyDetails?.namedCurve).toBe('prime256v1')
    expect(x509.subject).toContain('CN=Tolki Host')
    expect(new Date(x509.validTo).getFullYear()).toBeGreaterThanOrEqual(
      new Date().getFullYear() + 19,
    )
  })

  it('stores the key readable only by the user', async () => {
    await loadOrCreateCertificate(dir)
    const info = await stat(join(dir, CERTIFICATE_FILE))

    if (process.platform !== 'win32') expect(info.mode & 0o777).toBe(0o600)
  })

  it('reuses the stored certificate, so the fingerprint stays stable', async () => {
    const first = await loadOrCreateCertificate(dir)
    const second = await loadOrCreateCertificate(dir)

    expect(second).toEqual(first)
  })

  it('replaces a corrupt file with a new certificate', async () => {
    const first = await loadOrCreateCertificate(dir)
    await writeFile(join(dir, CERTIFICATE_FILE), '{"version":1,"key":"x","cert":"garbage"}')

    const replaced = await loadOrCreateCertificate(dir)

    expect(replaced.fingerprint).not.toBe(first.fingerprint)
    const stored = JSON.parse(await readFile(join(dir, CERTIFICATE_FILE), 'utf8')) as {
      cert: string
    }
    expect(certificateFingerprint(stored.cert)).toBe(replaced.fingerprint)
  })

  it('creates the directory if it does not exist', async () => {
    const nested = join(dir, 'a', 'b')

    await expect(loadOrCreateCertificate(nested)).resolves.toHaveProperty('fingerprint')
  })
})
