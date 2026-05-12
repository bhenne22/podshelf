import { defineEventHandler, readBody, createError } from 'h3'
import { requireAdmin } from '../../../utils/auth'
import { logAudit } from '../../../utils/audit'
import getDb from '../../../db/index'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * POST /api/admin/networks
 *
 * Admin-only. Creates a new network. Slug must not collide with an existing
 * podcast slug — we want /podcasts/<slug> and /networks/<slug> to stay
 * mentally distinct.
 */
export default defineEventHandler(async (event) => {
  const user = requireAdmin(event)
  const body = await readBody(event)

  if (!body?.title) {
    throw createError({ statusCode: 400, statusMessage: 'title is required' })
  }
  const title = String(body.title).trim()
  if (!title) {
    throw createError({ statusCode: 400, statusMessage: 'title is required' })
  }

  const slug = body.slug ? slugify(String(body.slug)) : slugify(title)
  if (!slug) {
    throw createError({ statusCode: 400, statusMessage: 'unable to derive a slug from title' })
  }

  const db = getDb()
  if (db.prepare('SELECT 1 FROM networks WHERE slug = ?').get(slug)) {
    throw createError({ statusCode: 409, statusMessage: `Network slug "${slug}" already exists` })
  }
  if (db.prepare('SELECT 1 FROM podcasts WHERE slug = ?').get(slug)) {
    throw createError({
      statusCode: 409,
      statusMessage: `Slug "${slug}" is already in use by a podcast`,
    })
  }

  const description = body.description ? String(body.description).trim() || null : null

  const result = db.prepare(`
    INSERT INTO networks (slug, title, description)
    VALUES (?, ?, ?)
  `).run(slug, title, description)

  const id = Number(result.lastInsertRowid)
  logAudit(event, {
    podcastId: null,
    userId: user.id,
    action: 'network.create',
    entityType: 'network',
    entityId: id,
    summary: `Created network "${title}" (slug ${slug})`,
  })

  event.node.res.statusCode = 201
  return db.prepare('SELECT * FROM networks WHERE id = ?').get(id)
})
