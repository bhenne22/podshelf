import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import { logAudit, diffFields, summarizeChanges } from '../../../../utils/audit'
import getDb from '../../../../db/index'

const UPDATABLE = ['name', 'url', 'platform_id', 'notes'] as const

/**
 * PATCH /api/podcasts/[slug]/distribution/[id]
 *
 * Updates one destination's fields. Position is owned by the reorder
 * endpoint — keep these concerns separate so the audit log doesn't get
 * spammed by drag-to-reorder actions.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const id = Number(getRouterParam(event, 'id'))
  const { user, podcastId } = requirePodcastAccess(event, slug)

  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'distribution id required' })
  }

  const db = getDb()
  const existing = db.prepare(
    'SELECT name, url, platform_id, notes FROM podcast_distributions WHERE id = ? AND podcast_id = ?'
  ).get(id, podcastId) as Record<string, unknown> | undefined
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Distribution not found' })
  }

  const body = await readBody(event)
  const updates: string[] = []
  const values: Record<string, unknown> = { id }
  for (const field of UPDATABLE) {
    if (field in body) {
      if (field === 'name') {
        const v = String(body[field] ?? '').trim()
        if (!v) throw createError({ statusCode: 400, statusMessage: 'name cannot be blank' })
        values[field] = v
      } else {
        values[field] = body[field] == null ? null : String(body[field]).trim() || null
      }
      updates.push(`${field} = @${field}`)
    }
  }

  if (!updates.length) {
    throw createError({ statusCode: 400, statusMessage: 'No valid fields to update' })
  }

  updates.push(`updated_at = datetime('now')`)
  db.prepare(`UPDATE podcast_distributions SET ${updates.join(', ')} WHERE id = @id`).run(values)

  const after = db.prepare(
    'SELECT name, url, platform_id, notes FROM podcast_distributions WHERE id = ?'
  ).get(id) as Record<string, unknown>
  const diff = diffFields(existing, after)
  if (diff.changed.length > 0) {
    logAudit({
      podcastId,
      userId: user.id,
      action: 'distribution.update',
      entityType: 'distribution',
      entityId: id,
      summary: summarizeChanges(`Updated distribution "${after.name}"`, diff.changed),
      details: diff,
    })
  }

  return db.prepare('SELECT * FROM podcast_distributions WHERE id = ?').get(id)
})
