import { defineEventHandler, readBody, createError } from 'h3'
import { randomBytes, createHash } from 'crypto'
import { requireSessionAuth } from '../../../utils/auth'
import getDb from '../../../db/index'

/**
 * POST /api/me/api-keys
 *
 * Mints a new API key for the current user. The plaintext key is returned
 * exactly once in this response — the database stores only its sha256 hash.
 *
 * Body:
 *   - label (required): user-facing name
 *   - expires_at (optional): ISO date string in the future
 *   - podcast_slugs (optional): array of slugs to restrict the key to. Omit
 *     or null = unrestricted (inherits all of user's podcast access).
 */
export default defineEventHandler(async (event) => {
  const user = requireSessionAuth(event)
  const body = await readBody(event)

  const label = String(body?.label || '').trim()
  if (!label) {
    throw createError({ statusCode: 400, statusMessage: 'label is required' })
  }
  if (label.length > 100) {
    throw createError({ statusCode: 400, statusMessage: 'label is too long (max 100 chars)' })
  }

  const permissions = String(body?.permissions || 'full')
  if (!['read', 'write', 'full'].includes(permissions)) {
    throw createError({ statusCode: 400, statusMessage: 'permissions must be one of: read, write, full' })
  }

  let expiresAt: string | null = null
  if (body?.expires_at) {
    const d = new Date(String(body.expires_at))
    if (Number.isNaN(d.getTime())) {
      throw createError({ statusCode: 400, statusMessage: 'expires_at must be a valid date' })
    }
    if (d.getTime() <= Date.now()) {
      throw createError({ statusCode: 400, statusMessage: 'expires_at must be in the future' })
    }
    expiresAt = d.toISOString()
  }

  // Validate podcast_slugs if provided
  const db = getDb()
  let scopedPodcastIds: number[] | null = null
  if (Array.isArray(body?.podcast_slugs) && body.podcast_slugs.length > 0) {
    scopedPodcastIds = []
    for (const raw of body.podcast_slugs) {
      const slug = String(raw).trim()
      if (!slug) continue
      const podcast = db.prepare('SELECT id FROM podcasts WHERE slug = ?').get(slug) as { id: number } | undefined
      if (!podcast) {
        throw createError({ statusCode: 400, statusMessage: `Unknown podcast slug: ${slug}` })
      }
      // The user must have access to each podcast they're scoping the key to
      if (!user.is_admin) {
        const member = db.prepare('SELECT 1 FROM podcast_users WHERE podcast_id = ? AND user_id = ?')
          .get(podcast.id, user.id)
        if (!member) {
          throw createError({ statusCode: 403, statusMessage: `You don't have access to podcast: ${slug}` })
        }
      }
      scopedPodcastIds.push(podcast.id)
    }
    if (scopedPodcastIds.length === 0) scopedPodcastIds = null
  }

  // 32 bytes -> 64 hex chars; "pk_" prefix for human recognizability
  const plaintext = `pk_${randomBytes(32).toString('hex')}`
  const keyHash = createHash('sha256').update(plaintext).digest('hex')

  const insert = db.transaction((scopedIds: number[] | null) => {
    const result = db.prepare(`
      INSERT INTO api_keys (user_id, key_hash, label, expires_at, permissions)
      VALUES (?, ?, ?, ?, ?)
    `).run(user.id, keyHash, label, expiresAt, permissions)
    const keyId = result.lastInsertRowid as number
    if (scopedIds) {
      const stmt = db.prepare('INSERT INTO api_key_podcasts (api_key_id, podcast_id) VALUES (?, ?)')
      for (const pid of scopedIds) stmt.run(keyId, pid)
    }
    return keyId
  })

  const keyId = insert(scopedPodcastIds)

  const row = db.prepare(`
    SELECT id, label, expires_at, disabled, permissions, created_at, last_used_at
    FROM api_keys WHERE id = ?
  `).get(keyId)

  const slugs = scopedPodcastIds
    ? (db.prepare(`
        SELECT p.slug FROM api_key_podcasts akp
        JOIN podcasts p ON p.id = akp.podcast_id
        WHERE akp.api_key_id = ?
        ORDER BY p.slug
      `).all(keyId) as { slug: string }[]).map((r) => r.slug)
    : null

  event.node.res.statusCode = 201
  return { ...(row as object), podcast_slugs: slugs, key: plaintext }
})
