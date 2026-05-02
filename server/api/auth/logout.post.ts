import { defineEventHandler, setCookie } from 'h3'
import { SESSION_COOKIE_NAME } from '../../utils/auth'

/**
 * POST /api/auth/logout
 *
 * Clears the session cookie.
 */
export default defineEventHandler((event) => {
  setCookie(event, SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })

  return { ok: true }
})
