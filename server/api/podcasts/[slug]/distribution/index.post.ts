import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import { logAudit } from '../../../../utils/audit'
import getDb from '../../../../db/index'

/**
 * POST /api/podcasts/[slug]/distribution
 *
 * Adds a destination to the podcast's "Listen on" list. New rows go to the
 * bottom (position = max + 1).
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { user, podcastId } = requirePodcastAccess(event, slug)

  const body = await readBody(event)
  const name = String(body?.name ?? '').trim()
  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'name is required' })
  }

  const url = body?.url ? String(body.url).trim() || null : null
  const platformId = body?.platform_id ? String(body.platform_id).trim() || null : null
  const notes = body?.notes ? String(body.notes).trim() || null : null

  const db = getDb()
  const max = db.prepare(
    'SELECT COALESCE(MAX(position), -1) AS m FROM podcast_distributions WHERE podcast_id = ?'
  ).get(podcastId) as { m: number }
  const position = (max?.m ?? -1) + 1

  const result = db.prepare(`
    INSERT INTO podcast_distributions (podcast_id, name, url, platform_id, notes, position)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(podcastId, name, url, platformId, notes, position)

  const id = Number(result.lastInsertRowid)
  logAudit(event, {
    podcastId,
    userId: user.id,
    action: 'distribution.create',
    entityType: 'distribution',
    entityId: id,
    summary: `Added "${name}" to distribution list`,
  })

  event.node.res.statusCode = 201
  return db.prepare('SELECT * FROM podcast_distributions WHERE id = ?').get(id)
})
