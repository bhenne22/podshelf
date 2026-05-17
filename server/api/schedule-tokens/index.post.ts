import { defineEventHandler, readBody, createError } from 'h3'
import { randomBytes } from 'crypto'
import { requireAuth, getUserNetworkIds } from '../../utils/auth'
import getDb from '../../db/index'

/**
 * POST /api/schedule-tokens
 *
 * Mints a calendar-subscribe token. The token is the share unit (it goes
 * in the .ics URL), so the user must have access to the scope at mint
 * time but the token itself isn't re-checked against access at fetch time
 * — revoking is the way to take it back.
 *
 * Body:
 *   - scope_type: 'podcast' | 'network'
 *   - scope_slug: slug of the podcast or network
 *   - label (optional): user-facing name (e.g. "iPhone", "Work calendar")
 */
export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const body = await readBody(event)

  const scopeType = String(body?.scope_type || '').trim()
  if (scopeType !== 'podcast' && scopeType !== 'network') {
    throw createError({ statusCode: 400, statusMessage: 'scope_type must be "podcast" or "network"' })
  }

  const scopeSlug = String(body?.scope_slug || '').trim()
  if (!scopeSlug) {
    throw createError({ statusCode: 400, statusMessage: 'scope_slug is required' })
  }

  const label = body?.label ? String(body.label).trim() : null
  if (label && label.length > 100) {
    throw createError({ statusCode: 400, statusMessage: 'label is too long (max 100 chars)' })
  }

  const db = getDb()

  // Resolve scope_slug → scope_id, with the same access checks the rest of
  // the API uses. Admins always pass; non-admin users need podcast_users
  // membership for podcasts or any-podcast-in-network membership for
  // networks (the implicit-membership rule).
  let scopeId: number
  if (scopeType === 'podcast') {
    const podcast = db.prepare('SELECT id FROM podcasts WHERE slug = ?').get(scopeSlug) as { id: number } | undefined
    if (!podcast) throw createError({ statusCode: 404, statusMessage: 'Podcast not found' })
    if (!user.is_admin) {
      const member = db.prepare('SELECT 1 FROM podcast_users WHERE podcast_id = ? AND user_id = ?')
        .get(podcast.id, user.id)
      if (!member) throw createError({ statusCode: 403, statusMessage: 'You do not have access to this podcast' })
    }
    scopeId = podcast.id
  } else {
    const network = db.prepare('SELECT id FROM networks WHERE slug = ?').get(scopeSlug) as { id: number } | undefined
    if (!network) throw createError({ statusCode: 404, statusMessage: 'Network not found' })
    if (!user.is_admin) {
      const allowedNetworkIds = getUserNetworkIds(user.id)
      if (!allowedNetworkIds.includes(network.id)) {
        throw createError({ statusCode: 403, statusMessage: 'You do not have access to this network' })
      }
    }
    scopeId = network.id
  }

  // 32 bytes → 43 url-safe base64 chars. "st_" prefix mirrors the api_keys
  // "pk_" convention so it's obvious what kind of credential this is.
  const token = `st_${randomBytes(32).toString('base64url')}`

  const result = db.prepare(`
    INSERT INTO schedule_tokens (user_id, token, scope_type, scope_id, label)
    VALUES (?, ?, ?, ?, ?)
  `).run(user.id, token, scopeType, scopeId, label)

  const row = db.prepare(`
    SELECT id, token, scope_type, scope_id, label, created_at, revoked_at
    FROM schedule_tokens WHERE id = ?
  `).get(result.lastInsertRowid)

  event.node.res.statusCode = 201
  return { ...(row as object), scope_slug: scopeSlug }
})
