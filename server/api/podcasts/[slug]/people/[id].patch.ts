import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import { bumpFeedLastModified } from '../../../../utils/feed-cache'
import { logAudit, diffFields, summarizeChanges } from '../../../../utils/audit'
import getDb from '../../../../db/index'

const UPDATABLE = ['name', 'img_url', 'href', 'default_role', 'default_group', 'auto_attach']

/**
 * PATCH /api/podcasts/[slug]/people/[id]
 *
 * Updates a person's roster record. Per-episode role/group are intentionally
 * NOT touched — those are frozen at attach time so a name/role change here
 * doesn't rewrite past episodes' attribution.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const id = Number(getRouterParam(event, 'id'))
  const { user, podcastId } = requirePodcastAccess(event, slug)

  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'person id required' })
  }

  const db = getDb()
  const existing = db.prepare(
    'SELECT name, img_url, href, default_role, default_group, auto_attach FROM people WHERE id = ? AND podcast_id = ?'
  ).get(id, podcastId) as Record<string, unknown> | undefined
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Person not found' })
  }

  const body = await readBody(event)
  const updates: string[] = []
  const values: Record<string, unknown> = { id }
  for (const field of UPDATABLE) {
    if (field in body) {
      updates.push(`${field} = @${field}`)
      if (field === 'auto_attach') {
        values[field] = body[field] ? 1 : 0
      } else if (field === 'name') {
        const v = String(body[field] ?? '').trim()
        if (!v) throw createError({ statusCode: 400, statusMessage: 'name cannot be blank' })
        values[field] = v
      } else {
        const v = body[field] == null ? null : String(body[field]).trim() || null
        values[field] = v
      }
    }
  }

  if (!updates.length) {
    throw createError({ statusCode: 400, statusMessage: 'No valid fields to update' })
  }

  updates.push(`updated_at = datetime('now')`)
  db.prepare(`UPDATE people SET ${updates.join(', ')} WHERE id = @id`).run(values)

  // Name / img / href updates are reflected live in the feed; bump the
  // cache marker so subscribers refetch.
  bumpFeedLastModified(podcastId)

  const after = db.prepare(
    'SELECT name, img_url, href, default_role, default_group, auto_attach FROM people WHERE id = ?'
  ).get(id) as Record<string, unknown>
  const diff = diffFields(existing, after)
  if (diff.changed.length > 0) {
    logAudit({
      podcastId,
      userId: user.id,
      action: 'people.update',
      entityType: 'person',
      entityId: id,
      summary: summarizeChanges(`Updated person "${after.name}"`, diff.changed),
      details: diff,
    })
  }

  return db.prepare('SELECT * FROM people WHERE id = ?').get(id)
})
