import { defineEventHandler, getRouterParam, createError, setResponseStatus } from 'h3'
import { requireAuth } from '../../utils/auth'
import getDb from '../../db/index'

/**
 * DELETE /api/schedule-tokens/[id]
 *
 * Revokes the token (soft delete via revoked_at) so the .ics route can
 * answer 410 Gone — calendar apps that understand 410 drop the subscription
 * cleanly instead of polling forever. The row stays in place so the user
 * can see "revoked" entries in the UI and so a re-mint with the same
 * scope is a brand-new row, not a resurrection.
 */
export default defineEventHandler((event) => {
  const user = requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const db = getDb()
  const result = db.prepare(`
    UPDATE schedule_tokens
    SET revoked_at = datetime('now')
    WHERE id = ? AND user_id = ? AND revoked_at IS NULL
  `).run(id, user.id)
  if (result.changes === 0) {
    // Either the token doesn't exist, isn't owned by this user, or was
    // already revoked. All three are "no-op from the caller's perspective."
    throw createError({ statusCode: 404, statusMessage: 'Token not found or already revoked' })
  }
  setResponseStatus(event, 204)
  return null
})
