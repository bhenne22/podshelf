import { defineEventHandler, getRouterParam, createError, setResponseStatus } from 'h3'
import { requireAdmin } from '../../utils/auth'
import getDb from '../../db/index'

/**
 * DELETE /api/users/[id]
 *
 * Admin-only. Cascades to api_keys and podcast_users.
 */
export default defineEventHandler((event) => {
  const me = requireAdmin(event)
  const id = getRouterParam(event, 'id')

  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })
  if (Number(id) === me.id) {
    throw createError({ statusCode: 400, statusMessage: 'Cannot delete your own account' })
  }

  const db = getDb()
  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(id) as { id: number } | undefined
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'User not found' })

  db.prepare('DELETE FROM users WHERE id = ?').run(id)
  setResponseStatus(event, 204)
  return null
})
