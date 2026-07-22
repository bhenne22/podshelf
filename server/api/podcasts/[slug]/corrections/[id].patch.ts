import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import { logAudit, diffFields, summarizeChanges } from '../../../../utils/audit'
import { isCorrectionStatus } from '../../../../utils/correction'
import getDb from '../../../../db/index'

/**
 * PATCH /api/podcasts/[slug]/corrections/[id]
 *
 * Triage a submission: move it through new → confirmed/rejected → aired,
 * attach a resolution note, and record which episode we owned up on.
 *
 * The submitted content itself (claim, correction, contact) is immutable —
 * it's a record of what a listener told us, not a document we edit.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const id = Number(getRouterParam(event, 'id'))
  const { user, podcastId } = requirePodcastAccess(event, slug)

  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'correction id required' })
  }

  const db = getDb()
  const existing = db.prepare(`
    SELECT status, resolution_note, aired_episode_id
    FROM corrections WHERE id = ? AND podcast_id = ?
  `).get(id, podcastId) as Record<string, unknown> | undefined
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Correction not found' })
  }

  const body = await readBody(event)
  const updates: string[] = []
  const values: Record<string, unknown> = { id }

  if ('status' in body) {
    if (!isCorrectionStatus(body.status)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'status must be one of: new, confirmed, rejected, aired',
      })
    }
    values.status = body.status
    updates.push('status = @status')
  }

  if ('resolution_note' in body) {
    const v = body.resolution_note == null ? null : String(body.resolution_note).trim() || null
    if (v && v.length > 4000) {
      throw createError({ statusCode: 400, statusMessage: 'resolution_note must be 4000 characters or fewer' })
    }
    values.resolution_note = v
    updates.push('resolution_note = @resolution_note')
  }

  if ('aired_episode_id' in body) {
    if (body.aired_episode_id == null || body.aired_episode_id === '') {
      values.aired_episode_id = null
    } else {
      const epId = Number(body.aired_episode_id)
      if (!Number.isInteger(epId)) {
        throw createError({ statusCode: 400, statusMessage: 'aired_episode_id must be an integer' })
      }
      // Scoped to this podcast so a member can't point a correction at
      // another tenant's episode.
      const ep = db.prepare('SELECT id FROM episodes WHERE id = ? AND podcast_id = ?')
        .get(epId, podcastId)
      if (!ep) {
        throw createError({ statusCode: 400, statusMessage: 'aired_episode_id is not an episode of this podcast' })
      }
      values.aired_episode_id = epId
    }
    updates.push('aired_episode_id = @aired_episode_id')
  }

  if (!updates.length) {
    throw createError({ statusCode: 400, statusMessage: 'No valid fields to update' })
  }

  updates.push(`updated_at = datetime('now')`)
  db.prepare(`UPDATE corrections SET ${updates.join(', ')} WHERE id = @id`).run(values)

  const after = db.prepare(`
    SELECT status, resolution_note, aired_episode_id FROM corrections WHERE id = ?
  `).get(id) as Record<string, unknown>
  const diff = diffFields(existing, after)
  if (diff.changed.length > 0) {
    logAudit(event, {
      podcastId,
      userId: user.id,
      action: 'correction.update',
      entityType: 'correction',
      entityId: id,
      summary: summarizeChanges(`Triaged correction #${id}`, diff.changed),
      details: diff,
    })
  }

  return db.prepare(`
    SELECT id, episode_id, episode_slug, timecode, claim, correction,
           source_url, submitter_name, submitter_contact, status,
           resolution_note, aired_episode_id, created_at, updated_at
    FROM corrections WHERE id = ?
  `).get(id)
})
