import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import getDb from '../../../../db/index'

/**
 * POST /api/podcasts/[slug]/people
 *
 * Creates a person in the podcast's roster.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)

  const body = await readBody(event)
  const name = String(body?.name ?? '').trim()
  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'name is required' })
  }

  const defaultRole = String(body?.default_role ?? 'host').trim() || 'host'
  const defaultGroup = String(body?.default_group ?? 'cast').trim() || 'cast'
  const autoAttach = body?.auto_attach ? 1 : 0

  const db = getDb()
  const result = db.prepare(`
    INSERT INTO people (podcast_id, name, img_url, href, default_role, default_group, auto_attach)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    podcastId,
    name,
    body?.img_url ? String(body.img_url).trim() || null : null,
    body?.href ? String(body.href).trim() || null : null,
    defaultRole,
    defaultGroup,
    autoAttach,
  )

  event.node.res.statusCode = 201
  return db.prepare('SELECT * FROM people WHERE id = ?').get(result.lastInsertRowid)
})
