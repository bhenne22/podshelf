import { defineEventHandler } from 'h3'
import { requireAdmin } from '../../utils/auth'
import getDb from '../../db/index'

/**
 * GET /api/admin/inactive-podcasts
 *
 * Lists every soft-deleted podcast across the platform. Admin-only.
 * Used by the purge UI.
 */
export default defineEventHandler((event) => {
  requireAdmin(event)
  const db = getDb()
  return db.prepare(`
    SELECT id, slug, title, description, image_url, website,
           status, deleted_at, created_at, updated_at
    FROM podcasts
    WHERE status = 'inactive'
    ORDER BY deleted_at DESC
  `).all()
})
