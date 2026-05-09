import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { requireAdmin } from '../../../utils/auth'
import { logAudit } from '../../../utils/audit'
import getDb from '../../../db/index'

/**
 * PUT /api/users/[id]/podcasts
 *
 * Admin-only. Replaces the user's full set of podcast memberships with the
 * given list of podcast IDs. Computes the diff against current membership and
 * emits a podcast.member.add / podcast.member.remove audit-log entry per
 * affected podcast so each podcast's audit history shows the change.
 *
 * Body: { podcast_ids: number[] }
 */
export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })
  const userId = Number(id)
  if (!Number.isFinite(userId)) {
    throw createError({ statusCode: 400, statusMessage: 'id must be numeric' })
  }

  const body = await readBody(event)
  if (!body || !Array.isArray(body.podcast_ids)) {
    throw createError({ statusCode: 400, statusMessage: 'podcast_ids must be an array of numbers' })
  }
  const desired = new Set<number>(
    body.podcast_ids
      .map((v: unknown) => Number(v))
      .filter((n: number) => Number.isFinite(n)),
  )

  const db = getDb()
  const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(userId) as
    | { id: number; email: string }
    | undefined
  if (!user) throw createError({ statusCode: 404, statusMessage: 'User not found' })

  // Verify each desired podcast exists (avoid silently dropping bad ids).
  if (desired.size > 0) {
    const placeholders = Array.from(desired).map(() => '?').join(',')
    const existing = db.prepare(
      `SELECT id FROM podcasts WHERE id IN (${placeholders})`
    ).all(...desired) as { id: number }[]
    if (existing.length !== desired.size) {
      throw createError({ statusCode: 400, statusMessage: 'One or more podcast_ids do not exist' })
    }
  }

  const current = new Set<number>(
    (db.prepare('SELECT podcast_id FROM podcast_users WHERE user_id = ?').all(userId) as
      { podcast_id: number }[])
      .map((r) => r.podcast_id),
  )

  const toAdd = [...desired].filter((p) => !current.has(p))
  const toRemove = [...current].filter((p) => !desired.has(p))

  db.transaction(() => {
    if (toRemove.length) {
      const stmt = db.prepare('DELETE FROM podcast_users WHERE user_id = ? AND podcast_id = ?')
      for (const pid of toRemove) stmt.run(userId, pid)
    }
    if (toAdd.length) {
      const stmt = db.prepare('INSERT OR IGNORE INTO podcast_users (podcast_id, user_id) VALUES (?, ?)')
      for (const pid of toAdd) stmt.run(pid, userId)
    }
  })()

  for (const pid of toAdd) {
    logAudit(event, {
      podcastId: pid,
      userId: admin.id,
      action: 'podcast.member.add',
      entityType: 'user',
      entityId: userId,
      summary: `Added ${user.email} as a podcast member`,
    })
  }
  for (const pid of toRemove) {
    logAudit(event, {
      podcastId: pid,
      userId: admin.id,
      action: 'podcast.member.remove',
      entityType: 'user',
      entityId: userId,
      summary: `Removed ${user.email} from podcast members`,
    })
  }

  return {
    user_id: userId,
    podcast_ids: [...desired],
    added: toAdd,
    removed: toRemove,
  }
})
