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
