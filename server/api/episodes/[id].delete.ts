import { defineEventHandler, getRouterParam, createError, setResponseStatus } from 'h3'
import { requireAuth } from '../../utils/auth'
import getDb from '../../db/index'

export default defineEventHandler((event) => {
  requireAuth(event)

  const db = getDb()
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'id is required' })
  }

  const existing = db.prepare('SELECT id FROM episodes WHERE id = ?').get(id)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Episode not found' })
  }

  db.prepare('DELETE FROM episodes WHERE id = ?').run(id)

  setResponseStatus(event, 204)
  return null
})
