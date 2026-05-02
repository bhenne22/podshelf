import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16

/**
 * Loads the encryption key from PODSHELF_ENCRYPTION_KEY runtimeConfig.
 * Accepts hex (64 chars) or base64 (44 chars) encoding. Must decode to 32 bytes.
 */
function loadKey(): Buffer {
  const raw = (useRuntimeConfig().encryptionKey || '').trim()
  if (!raw) {
    throw new Error('PODSHELF_ENCRYPTION_KEY is not set')
  }

  let key: Buffer
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length === 64) {
    key = Buffer.from(raw, 'hex')
  } else {
    try {
      key = Buffer.from(raw, 'base64')
    } catch {
      throw new Error('PODSHELF_ENCRYPTION_KEY must be 32 bytes (64 hex chars or 44 base64 chars)')
    }
  }
  if (key.length !== 32) {
    throw new Error(`PODSHELF_ENCRYPTION_KEY must decode to 32 bytes, got ${key.length}`)
  }
  return key
}

/**
 * Encrypts a string with AES-256-GCM. Output format:
 *   base64( iv (12 bytes) || tag (16 bytes) || ciphertext )
 */
export function encryptString(plaintext: string): string {
  const key = loadKey()
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ct]).toString('base64')
}

export function decryptString(blob: string): string {
  const key = loadKey()
  const buf = Buffer.from(blob, 'base64')
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error('Ciphertext too short')
  }
  const iv = buf.subarray(0, IV_LEN)
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const ct = buf.subarray(IV_LEN + TAG_LEN)
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf-8')
}

/**
 * Convenience: encrypt JSON-serializable value.
 */
export function encryptJson(value: unknown): string {
  return encryptString(JSON.stringify(value))
}

export function decryptJson<T = unknown>(blob: string): T {
  return JSON.parse(decryptString(blob)) as T
}
