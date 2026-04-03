import { defineEventHandler, setCookie } from 'h3'

/**
 * POST /api/auth/logout
 *
 * Clears the admin session cookie.
 */
export default defineEventHandler((event) => {
  setCookie(event, 'admin_session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })

  return { ok: true }
})
