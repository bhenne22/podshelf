import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requireAdmin } from '../../../../utils/auth'
import getDb from '../../../../db/index'

/**
 * POST /api/podcasts/[slug]/members
 *
 * Admin-only. Grants a user access to the podcast.
 * Body: { user_id } or { email }
 */
export default defineEventHandler(async (event) => {
  requireAdmin(event)

  const slug = getRouterParam(event, 'slug') as string
  const body = await readBody(event)

  const db = getDb()
  const podcast = db.prepare('SELECT id FROM podcasts WHERE slug = ?').get(slug) as { id: number } | undefined
  if (!podcast) {
    throw createError({ statusCode: 404, statusMessage: 'Podcast not found' })
  }

  let userId: number | null = null
  if (typeof body?.user_id === 'number') {
    userId = body.user_id
  } else if (typeof body?.email === 'string') {
    const u = db.prepare('SELECT id FROM users WHERE email = ?').get(body.email.toLowerCase()) as { id: number } | undefined
    if (!u) throw createError({ statusCode: 404, statusMessage: 'User not found' })
    userId = u.id
  } else {
    throw createError({ statusCode: 400, statusMessage: 'user_id or email required' })
  }

  db.prepare(`
    INSERT OR IGNORE INTO podcast_users (podcast_id, user_id) VALUES (?, ?)
  `).run(podcast.id, userId)

  event.node.res.statusCode = 201
  return { podcast_id: podcast.id, user_id: userId }
})
