import { defineEventHandler, readBody, createError } from 'h3'
import { requireAuth } from '../../utils/auth'
import getDb from '../../db/index'

export default defineEventHandler(async (event) => {
  requireAuth(event)

  const db = getDb()
  const body = await readBody(event)

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Body must be a key/value object' })
  }

  const ALLOWED_KEYS = new Set([
    'show_title', 'show_description', 'show_author', 'show_email',
    'show_image_url', 'show_language', 'show_copyright',
    'show_category', 'show_explicit', 'show_website',
    'audio_tracking_prefix',
  ])

  const invalidKeys = Object.keys(body).filter((k) => !ALLOWED_KEYS.has(k))
  if (invalidKeys.length) {
    throw createError({ statusCode: 400, statusMessage: `Unknown setting keys: ${invalidKeys.join(', ')}` })
  }

  const upsert = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (@key, @value, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = datetime('now')
  `)

  const upsertMany = db.transaction((entries: Array<{ key: string; value: string }>) => {
    for (const entry of entries) {
      upsert.run(entry)
    }
  })

  const entries = Object.entries(body).map(([key, value]) => ({
    key,
    value: String(value),
  }))

  upsertMany(entries)

  // Return updated settings
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
  const result: Record<string, string> = {}
  for (const row of rows) {
    result[row.key] = row.value
  }

  return result
})
