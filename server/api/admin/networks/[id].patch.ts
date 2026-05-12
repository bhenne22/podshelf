import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requireAdmin } from '../../../utils/auth'
import { logAudit, diffFields, summarizeChanges } from '../../../utils/audit'
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
 * PATCH /api/admin/networks/[id]
 *
 * Edit network metadata. Re-slugging is allowed but must not collide with an
 * existing network slug or any podcast slug.
 */
export default defineEventHandler(async (event) => {
  const user = requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'network id required' })
  }

  const db = getDb()
  const existing = db.prepare(
    'SELECT slug, title, description FROM networks WHERE id = ?'
  ).get(id) as Record<string, unknown> | undefined
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Network not found' })
  }

  const body = await readBody(event)
  const updates: string[] = []
  const values: Record<string, unknown> = { id }

  if ('slug' in body) {
    const next = slugify(String(body.slug ?? ''))
    if (!next) throw createError({ statusCode: 400, statusMessage: 'slug cannot be blank' })
    if (next !== existing.slug) {
      if (db.prepare('SELECT 1 FROM networks WHERE slug = ? AND id != ?').get(next, id)) {
        throw createError({ statusCode: 409, statusMessage: `Network slug "${next}" already exists` })
      }
      if (db.prepare('SELECT 1 FROM podcasts WHERE slug = ?').get(next)) {
        throw createError({
          statusCode: 409,
          statusMessage: `Slug "${next}" is already in use by a podcast`,
        })
      }
    }
    values.slug = next
    updates.push('slug = @slug')
  }
  if ('title' in body) {
    const next = String(body.title ?? '').trim()
    if (!next) throw createError({ statusCode: 400, statusMessage: 'title cannot be blank' })
    values.title = next
    updates.push('title = @title')
  }
  if ('description' in body) {
    values.description = body.description == null ? null : String(body.description).trim() || null
    updates.push('description = @description')
  }

  if (!updates.length) {
    throw createError({ statusCode: 400, statusMessage: 'No valid fields to update' })
  }

  updates.push(`updated_at = datetime('now')`)
  db.prepare(`UPDATE networks SET ${updates.join(', ')} WHERE id = @id`).run(values)

  const after = db.prepare(
    'SELECT slug, title, description FROM networks WHERE id = ?'
  ).get(id) as Record<string, unknown>
  const diff = diffFields(existing, after)
  if (diff.changed.length > 0) {
    logAudit(event, {
      podcastId: null,
      userId: user.id,
      action: 'network.update',
      entityType: 'network',
      entityId: id,
      summary: summarizeChanges(`Updated network "${after.title}"`, diff.changed),
      details: diff,
    })
  }

  return db.prepare('SELECT * FROM networks WHERE id = ?').get(id)
})
