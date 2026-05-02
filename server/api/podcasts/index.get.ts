import { defineEventHandler } from 'h3'
import { requireAuthContext } from '../../utils/auth'
import getDb from '../../db/index'

/**
 * GET /api/podcasts
 *
 * Lists podcasts visible to the request:
 *   - Admins see all (unless the API key is scoped — then only the scoped set).
 *   - Non-admins see their podcast_users memberships, intersected with any
 *     API key scope.
 */
export default defineEventHandler((event) => {
  const ctx = requireAuthContext(event)
  const db = getDb()

  const restricted = ctx.restrictedPodcastIds
  const fields = `id, slug, title, description, image_url, website, created_at, updated_at`

  if (ctx.user.is_admin) {
    if (restricted !== null) {
      if (restricted.length === 0) return []
      const placeholders = restricted.map(() => '?').join(',')
      return db.prepare(`
        SELECT ${fields} FROM podcasts
        WHERE id IN (${placeholders})
        ORDER BY title
      `).all(...restricted)
    }
    return db.prepare(`SELECT ${fields} FROM podcasts ORDER BY title`).all()
  }

  // Non-admin: their memberships, intersected with scope if present
  if (restricted !== null && restricted.length === 0) return []

  const params: (number | string)[] = [ctx.user.id]
  let scopeClause = ''
  if (restricted !== null) {
    const placeholders = restricted.map(() => '?').join(',')
    scopeClause = ` AND p.id IN (${placeholders})`
    params.push(...restricted)
  }

  return db.prepare(`
    SELECT p.id, p.slug, p.title, p.description, p.image_url, p.website, p.created_at, p.updated_at
    FROM podcasts p
    JOIN podcast_users pu ON pu.podcast_id = p.id
    WHERE pu.user_id = ?${scopeClause}
    ORDER BY p.title
  `).all(...params)
})
