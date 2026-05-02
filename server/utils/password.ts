import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'

const KEY_LEN = 64
const SALT_LEN = 16

/**
 * Hash a password with scrypt. Returns "scrypt$<salt-hex>$<hash-hex>".
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN)
  const hash = scryptSync(password, salt, KEY_LEN)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

/**
 * Verify a password against a stored hash. Returns true on match.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const salt = Buffer.from(parts[1], 'hex')
  const expected = Buffer.from(parts[2], 'hex')
  const actual = scryptSync(password, salt, expected.length)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
