import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requireAuth } from '../../utils/auth'
import getDb from '../../db/index'

export default defineEventHandler(async (event) => {
  requireAuth(event)

  const db = getDb()
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'id is required' })
  }

  const existing = db.prepare('SELECT * FROM episodes WHERE id = ?').get(id)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Episode not found' })
  }

  const body = await readBody(event)

  // Build dynamic SET clause from provided fields
  const allowedFields = [
    'title', 'slug', 'episode_number', 'season_number',
    'description', 'audio_url', 'audio_filename', 'audio_size_bytes',
    'audio_duration_seconds', 'published_at', 'status', 'tags', 'transcript_path',
  ]

  const updates: string[] = []
  const values: Record<string, unknown> = {}

  for (const field of allowedFields) {
    if (field in body) {
      updates.push(`${field} = @${field}`)
      values[field] = body[field]
    }
  }

  if (updates.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'No valid fields to update' })
  }

  // Always update updated_at
  updates.push(`updated_at = datetime('now')`)
  values.id = id

  const sql = `UPDATE episodes SET ${updates.join(', ')} WHERE id = @id`
  db.prepare(sql).run(values)

  const updated = db.prepare('SELECT * FROM episodes WHERE id = ?').get(id)
  return updated
})
