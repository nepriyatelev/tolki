import { createHash, X509Certificate } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { generate } from 'selfsigned'
import { z } from 'zod'

export interface HostCertificate {
  key: string
  cert: string
  /** SHA-256 of the DER certificate, base64url: the `fp` parameter of invite links. */
  fingerprint: string
}

export const CERTIFICATE_FILE = 'host-certificate.json'
const VALIDITY_YEARS = 20

const storedSchema = z.object({ version: z.literal(1), key: z.string(), cert: z.string() })

export function certificateFingerprint(certPem: string): string {
  return createHash('sha256').update(new X509Certificate(certPem).raw).digest('base64url')
}

/**
 * Returns this installation's host certificate, creating it on first use. One certificate per
 * installation keeps the fingerprint (and so old invite links) stable across rooms.
 */
export async function loadOrCreateCertificate(dir: string): Promise<HostCertificate> {
  const file = join(dir, CERTIFICATE_FILE)
  const stored = await readStored(file)
  if (stored) return { ...stored, fingerprint: certificateFingerprint(stored.cert) }

  const created = await createCertificate()
  await mkdir(dir, { recursive: true })
  // Write-then-rename so a crash never leaves a half-written key behind.
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify({ version: 1, ...created }), { mode: 0o600 })
  await rename(tmp, file)
  return { ...created, fingerprint: certificateFingerprint(created.cert) }
}

async function readStored(file: string): Promise<{ key: string; cert: string } | null> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return null
  }
  try {
    const parsed = storedSchema.parse(JSON.parse(raw))
    const x509 = new X509Certificate(parsed.cert)
    if (new Date(x509.validTo) <= new Date()) return null
    return { key: parsed.key, cert: parsed.cert }
  } catch {
    // Corrupt or foreign file: replace it. Old invite links stop matching, which is safe.
    return null
  }
}

async function createCertificate(): Promise<{ key: string; cert: string }> {
  const notBeforeDate = new Date()
  const notAfterDate = new Date(notBeforeDate)
  notAfterDate.setFullYear(notAfterDate.getFullYear() + VALIDITY_YEARS)

  const pems = await generate([{ name: 'commonName', value: 'Tolki Host' }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
    notBeforeDate,
    notAfterDate,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true },
      { name: 'extKeyUsage', serverAuth: true },
    ],
  })
  return { key: pems.private, cert: pems.cert }
}
