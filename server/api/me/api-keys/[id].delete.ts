import { defineEventHandler, getRouterParam, createError, setResponseStatus } from 'h3'
import { requireSessionAuth } from '../../../utils/auth'
import getDb from '../../../db/index'

/**
 * DELETE /api/me/api-keys/[id]
 *
 * Revokes (permanently deletes) a key the current user owns.
 */
export default defineEventHandler((event) => {
  const user = requireSessionAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const db = getDb()
  const result = db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?').run(id, user.id)
  if (result.changes === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Key not found' })
  }
  setResponseStatus(event, 204)
  return null
})
