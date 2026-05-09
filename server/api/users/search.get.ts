import { defineEventHandler, getQuery } from 'h3'
import { requireAdmin } from '../../utils/auth'
import getDb from '../../db/index'

/**
 * GET /api/users/search?q=…
 *
 * Admin-only typeahead search across email / full_name / display_name.
 * Returns up to 10 matches; case-insensitive substring match.
 */
export default defineEventHandler((event) => {
  requireAdmin(event)

  const q = String(getQuery(event).q || '').trim()
  if (!q) return []

  const like = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`
  const db = getDb()
  return db.prepare(`
    SELECT id, email, full_name, display_name, is_admin
    FROM users
    WHERE email LIKE @q ESCAPE '\\'
       OR (full_name IS NOT NULL    AND full_name    LIKE @q ESCAPE '\\')
       OR (display_name IS NOT NULL AND display_name LIKE @q ESCAPE '\\')
    ORDER BY COALESCE(display_name, full_name, email)
    LIMIT 10
  `).all({ q: like })
})
