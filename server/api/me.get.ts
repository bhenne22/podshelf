import { defineEventHandler } from 'h3'
import { requireAuth } from '../utils/auth'

/**
 * GET /api/me
 *
 * Returns the currently authenticated user.
 */
export default defineEventHandler((event) => {
  const user = requireAuth(event)
  return { id: user.id, email: user.email, is_admin: !!user.is_admin }
})
