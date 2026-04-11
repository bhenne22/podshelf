import { defineEventHandler, readBody, createError, setCookie, getRequestIP } from 'h3'
import { createHmac, randomBytes } from 'crypto'

const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const attempts = new Map<string, number[]>()

function checkRateLimit(ip: string) {
  const now = Date.now()
  const timestamps = (attempts.get(ip) || []).filter((t) => now - t < WINDOW_MS)
  if (timestamps.length >= MAX_ATTEMPTS) {
    throw createError({ statusCode: 429, statusMessage: 'Too many login attempts. Try again later.' })
  }
  timestamps.push(now)
  attempts.set(ip, timestamps)
}

/**
 * POST /api/auth/login
 *
 * Validates the admin password and sets a signed session cookie.
 */
export default defineEventHandler(async (event) => {
  const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  checkRateLimit(ip)

  const body = await readBody(event)

  if (!body?.password) {
    throw createError({ statusCode: 400, statusMessage: 'password is required' })
  }

  const config = useRuntimeConfig()
  const adminPassword = config.adminPassword

  if (!adminPassword) {
    throw createError({ statusCode: 500, statusMessage: 'ADMIN_PASSWORD not configured' })
  }

  if (body.password !== adminPassword) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid password' })
  }

  // Clear rate limit on successful login
  attempts.delete(ip)

  // Create a signed session token: nonce.signature
  const secretKey = config.secretKey || adminPassword
  const nonce = randomBytes(32).toString('hex')
  const signature = createHmac('sha256', secretKey).update(nonce).digest('hex')
  const token = `${nonce}.${signature}`

  setCookie(event, 'admin_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  })

  return { ok: true }
})
