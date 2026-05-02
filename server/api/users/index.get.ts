import { defineEventHandler } from 'h3'
import { requireAdmin } from '../../utils/auth'
import getDb from '../../db/index'

/**
 * GET /api/users
 *
 * Admin-only. Lists all users (no password hashes).
 */
export default defineEventHandler((event) => {
  requireAdmin(event)

  const db = getDb()
  return db.prepare(`
    SELECT id, email, is_admin, created_at, updated_at
    FROM users
    ORDER BY email
  `).all()
})
