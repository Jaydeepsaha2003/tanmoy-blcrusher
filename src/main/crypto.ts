import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

// Password storage format: "scrypt$<saltHex>$<hashHex>".
const PREFIX = 'scrypt$'

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  return `${PREFIX}${salt.toString('hex')}$${hash.toString('hex')}`
}

/** Verify a password against a stored value (scrypt hash, or legacy plaintext). */
export function verifyPassword(password: string, stored: string | undefined | null): boolean {
  if (!stored) return false
  if (stored.startsWith(PREFIX)) {
    const [, saltHex, hashHex] = stored.split('$')
    if (!saltHex || !hashHex) return false
    const expected = Buffer.from(hashHex, 'hex')
    const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  }
  // Legacy plaintext value (pre-hashing installs).
  return stored === password
}
