import { defineEventHandler } from 'h3'
import { requireAuth } from '../utils/auth'
import getDb from '../db/index'

/**
 * GET /api/me
 *
 * Returns the currently authenticated user.
 */
export default defineEventHandler((event) => {
  const user = requireAuth(event)
  const row = getDb().prepare(
    'SELECT full_name, display_name FROM users WHERE id = ?'
  ).get(user.id) as { full_name: string | null; display_name: string | null } | undefined
  return {
    id: user.id,
    email: user.email,
    is_admin: !!user.is_admin,
    full_name: row?.full_name ?? null,
    display_name: row?.display_name ?? null,
  }
})
