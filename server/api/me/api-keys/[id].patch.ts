import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requireAuth } from '../../../utils/auth'
import getDb from '../../../db/index'

/**
 * PATCH /api/me/api-keys/[id]
 *
 * Update label, expires_at, disabled flag, or podcast_slugs scope on a key
 * the current user owns.
 *
 * podcast_slugs semantics:
 *   - field absent      → don't change scope
 *   - null              → make key unrestricted
 *   - [] (empty array)  → make key unrestricted (treated same as null)
 *   - non-empty array   → replace scope with these slugs
 */
export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const db = getDb()
  const existing = db.prepare('SELECT id FROM api_keys WHERE id = ? AND user_id = ?').get(id, user.id)
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Key not found' })

  const body = await readBody(event)

  // Validate any new podcast_slugs first
  let newScopedIds: number[] | null | 'unchanged' = 'unchanged'
  if ('podcast_slugs' in (body || {})) {
    if (body.podcast_slugs === null || (Array.isArray(body.podcast_slugs) && body.podcast_slugs.length === 0)) {
      newScopedIds = null
    } else if (Array.isArray(body.podcast_slugs)) {
      const ids: number[] = []
      for (const raw of body.podcast_slugs) {
        const slug = String(raw).trim()
        if (!slug) continue
        const p = db.prepare('SELECT id FROM podcasts WHERE slug = ?').get(slug) as { id: number } | undefined
        if (!p) throw createError({ statusCode: 400, statusMessage: `Unknown podcast slug: ${slug}` })
        if (!user.is_admin) {
          const member = db.prepare('SELECT 1 FROM podcast_users WHERE podcast_id = ? AND user_id = ?')
            .get(p.id, user.id)
          if (!member) {
            throw createError({ statusCode: 403, statusMessage: `You don't have access to podcast: ${slug}` })
          }
        }
        ids.push(p.id)
      }
      newScopedIds = ids.length > 0 ? ids : null
    } else {
      throw createError({ statusCode: 400, statusMessage: 'podcast_slugs must be an array or null' })
    }
  }

  const updates: string[] = []
  const values: Record<string, unknown> = { id, user_id: user.id }

  if (typeof body?.label === 'string') {
    const label = body.label.trim()
    if (!label) throw createError({ statusCode: 400, statusMessage: 'label cannot be empty' })
    updates.push('label = @label')
    values.label = label
  }
  if ('expires_at' in (body || {})) {
    if (body.expires_at === null || body.expires_at === '') {
      updates.push('expires_at = NULL')
    } else {
      const d = new Date(String(body.expires_at))
      if (Number.isNaN(d.getTime())) {
        throw createError({ statusCode: 400, statusMessage: 'expires_at must be a valid date' })
      }
      updates.push('expires_at = @expires_at')
      values.expires_at = d.toISOString()
    }
  }
  if (body?.disabled !== undefined) {
    updates.push('disabled = @disabled')
    values.disabled = body.disabled ? 1 : 0
  }
  if (typeof body?.permissions === 'string') {
    if (!['read', 'write', 'full'].includes(body.permissions)) {
      throw createError({ statusCode: 400, statusMessage: 'permissions must be one of: read, write, full' })
    }
    updates.push('permissions = @permissions')
    values.permissions = body.permissions
  }

  if (!updates.length && newScopedIds === 'unchanged') {
    throw createError({ statusCode: 400, statusMessage: 'No valid fields to update' })
  }

  const tx = db.transaction(() => {
    if (updates.length) {
      db.prepare(`
        UPDATE api_keys SET ${updates.join(', ')}
        WHERE id = @id AND user_id = @user_id
      `).run(values)
    }
    if (newScopedIds !== 'unchanged') {
      db.prepare('DELETE FROM api_key_podcasts WHERE api_key_id = ?').run(id)
      if (newScopedIds) {
        const stmt = db.prepare('INSERT INTO api_key_podcasts (api_key_id, podcast_id) VALUES (?, ?)')
        for (const pid of newScopedIds) stmt.run(id, pid)
      }
    }
  })
  tx()

  const row = db.prepare(`
    SELECT id, label, expires_at, disabled, permissions, created_at, last_used_at
    FROM api_keys WHERE id = ?
  `).get(id) as Record<string, unknown>

  const slugs = (db.prepare(`
    SELECT p.slug FROM api_key_podcasts akp
    JOIN podcasts p ON p.id = akp.podcast_id
    WHERE akp.api_key_id = ?
    ORDER BY p.slug
  `).all(id) as { slug: string }[]).map((r) => r.slug)

  return { ...row, podcast_slugs: slugs.length ? slugs : null }
})
