import { defineEventHandler } from 'h3'
import { requireAuth } from '../../../utils/auth'
import getDb from '../../../db/index'

interface KeyRow {
  id: number
  label: string
  expires_at: string | null
  disabled: number
  permissions: string
  created_at: string
  last_used_at: string | null
}

/**
 * GET /api/me/api-keys
 *
 * Lists the current user's API keys. Each entry includes podcast_slugs:
 * an array of slugs the key is restricted to, or null if unrestricted.
 */
export default defineEventHandler((event) => {
  const user = requireAuth(event)
  const db = getDb()

  const keys = db.prepare(`
    SELECT id, label, expires_at, disabled, permissions, created_at, last_used_at
    FROM api_keys
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(user.id) as KeyRow[]

  if (!keys.length) return []

  const placeholders = keys.map(() => '?').join(',')
  const scopeRows = db.prepare(`
    SELECT akp.api_key_id, p.slug
    FROM api_key_podcasts akp
    JOIN podcasts p ON p.id = akp.podcast_id
    WHERE akp.api_key_id IN (${placeholders})
    ORDER BY p.slug
  `).all(...keys.map((k) => k.id)) as { api_key_id: number; slug: string }[]

  const scopeBy = new Map<number, string[]>()
  for (const r of scopeRows) {
    const existing = scopeBy.get(r.api_key_id) ?? []
    existing.push(r.slug)
    scopeBy.set(r.api_key_id, existing)
  }

  return keys.map((k) => ({
    ...k,
    podcast_slugs: scopeBy.get(k.id) ?? null,
  }))
})
