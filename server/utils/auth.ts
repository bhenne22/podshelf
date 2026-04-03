import { createHmac } from 'crypto'
import type { H3Event } from 'h3'
import { getCookie, getHeader, createError } from 'h3'

/**
 * Verify the admin_session cookie contains a valid HMAC-signed token.
 */
function isValidSession(event: H3Event, config: ReturnType<typeof useRuntimeConfig>): boolean {
  const token = getCookie(event, 'admin_session')
  if (!token) return false

  const [nonce, signature] = token.split('.')
  if (!nonce || !signature) return false

  const secretKey = config.secretKey || config.adminPassword
  const expected = createHmac('sha256', secretKey).update(nonce).digest('hex')

  return signature === expected
}

/**
 * Verify the Authorization header contains a valid API key.
 * Accepts: "Bearer <key>" or "X-Api-Key: <key>"
 */
function isValidApiKey(event: H3Event, config: ReturnType<typeof useRuntimeConfig>): boolean {
  if (!config.apiKey) return false

  // Check X-Api-Key header
  const xApiKey = getHeader(event, 'x-api-key')
  if (xApiKey && xApiKey === config.apiKey) return true

  // Check Authorization: Bearer <key>
  const authHeader = getHeader(event, 'authorization')
  if (authHeader?.startsWith('Bearer ') && authHeader.slice(7) === config.apiKey) return true

  return false
}

/**
 * Throws a 401 error if the request is not authenticated.
 * Accepts either a valid session cookie (admin UI) or a valid API key (automation).
 */
export function requireAuth(event: H3Event): void {
  const config = useRuntimeConfig()

  // Dev mode — no password configured
  if (!config.adminPassword) return

  if (isValidSession(event, config)) return
  if (isValidApiKey(event, config)) return

  throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
}
