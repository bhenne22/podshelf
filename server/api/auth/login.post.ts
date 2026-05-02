import { defineEventHandler, readBody, createError, setCookie, getRequestIP } from 'h3'
import getDb from '../../db/index'
import { verifyPassword } from '../../utils/password'
import { issueSessionToken, SESSION_COOKIE_NAME } from '../../utils/auth'

const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000
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
 * Body: { email, password }
 * Sets the admin_session cookie on success.
 */
export default defineEventHandler(async (event) => {
  const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  checkRateLimit(ip)

  const body = await readBody(event)
  const email = String(body?.email || '').trim().toLowerCase()
  const password = String(body?.password || '')

  if (!email || !password) {
    throw createError({ statusCode: 400, statusMessage: 'email and password are required' })
  }

  const db = getDb()
  const row = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email) as
    | { id: number; password_hash: string }
    | undefined

  if (!row || !verifyPassword(password, row.password_hash)) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid email or password' })
  }

  attempts.delete(ip)

  const token = issueSessionToken(row.id)
  setCookie(event, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })

  return { ok: true }
})
