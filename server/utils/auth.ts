import type { H3Event } from 'h3'
import { getCookie, getHeader, createError } from 'h3'
import { createHmac, createHash, timingSafeEqual } from 'crypto'
import getDb from '../db/index'

export interface AuthUser {
  id: number
  email: string
  is_admin: number
}

export type ApiKeyPermissions = 'read' | 'write' | 'full'

/**
 * Resolved auth result for a request.
 *  - restrictedPodcastIds: non-null when authed by a scoped API key — that
 *    key can only touch podcasts in the listed set, regardless of the user's
 *    underlying access.
 *  - permissionLevel: non-null when authed by an API key — limits which
 *    HTTP methods the request can use. Session auth has no such limit
 *    (treated as 'full').
 */
export interface AuthContext {
  user: AuthUser
  restrictedPodcastIds: number[] | null
  permissionLevel: ApiKeyPermissions | null
}

export const SESSION_COOKIE_NAME = 'admin_session'

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function b64urlDecode(str: string): Buffer {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4)
  return Buffer.from(padded, 'base64')
}

function getSecret(): string {
  const config = useRuntimeConfig()
  if (!config.secretKey) {
    throw createError({ statusCode: 500, statusMessage: 'NUXT_SECRET_KEY not configured' })
  }
  return config.secretKey
}

export function issueSessionToken(userId: number, ttlSeconds = 60 * 60 * 24 * 7): string {
  const secret = getSecret()
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const payload = b64url(Buffer.from(JSON.stringify({ uid: userId, exp })))
  const sig = b64url(createHmac('sha256', secret).update(payload).digest())
  return `${payload}.${sig}`
}

function verifySessionToken(token: string): { uid: number; exp: number } | null {
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return null
  const secret = getSecret()
  const expected = b64url(createHmac('sha256', secret).update(payload).digest())
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const decoded = JSON.parse(b64urlDecode(payload).toString())
    if (typeof decoded.uid !== 'number' || typeof decoded.exp !== 'number') return null
    if (Math.floor(Date.now() / 1000) > decoded.exp) return null
    return decoded
  } catch {
    return null
  }
}

function contextFromSession(event: H3Event): AuthContext | null {
  const token = getCookie(event, SESSION_COOKIE_NAME)
  if (!token) return null
  const claims = verifySessionToken(token)
  if (!claims) return null
  const db = getDb()
  const row = db.prepare('SELECT id, email, is_admin FROM users WHERE id = ?').get(claims.uid) as AuthUser | undefined
  if (!row) return null
  return { user: row, restrictedPodcastIds: null, permissionLevel: null }
}

function contextFromApiKey(event: H3Event): AuthContext | null {
  let key = getHeader(event, 'x-api-key')
  if (!key) {
    const auth = getHeader(event, 'authorization')
    if (auth?.startsWith('Bearer ')) key = auth.slice(7)
  }
  if (!key) return null
  const keyHash = createHash('sha256').update(key).digest('hex')
  const db = getDb()
  const row = db.prepare(`
    SELECT u.id, u.email, u.is_admin,
           k.id as key_id, k.disabled, k.expires_at, k.permissions
    FROM api_keys k
    JOIN users u ON u.id = k.user_id
    WHERE k.key_hash = ?
  `).get(keyHash) as (AuthUser & {
    key_id: number;
    disabled: number;
    expires_at: string | null;
    permissions: string;
  }) | undefined
  if (!row) return null
  if (row.disabled) return null
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return null

  const scope = db.prepare('SELECT podcast_id FROM api_key_podcasts WHERE api_key_id = ?')
    .all(row.key_id) as { podcast_id: number }[]
  const restrictedPodcastIds = scope.length > 0 ? scope.map((r) => r.podcast_id) : null

  const perm = (row.permissions === 'read' || row.permissions === 'write' || row.permissions === 'full')
    ? row.permissions
    : 'full'

  db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(row.key_id)
  return {
    user: { id: row.id, email: row.email, is_admin: row.is_admin },
    restrictedPodcastIds,
    permissionLevel: perm as ApiKeyPermissions,
  }
}

/**
 * Block requests whose HTTP method exceeds the API key's permission level.
 * Session auth bypasses this entirely (treated as full access).
 */
function enforceMethodPermission(event: H3Event, ctx: AuthContext) {
  if (!ctx.permissionLevel || ctx.permissionLevel === 'full') return
  const method = (event.method || 'GET').toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return
  if (method === 'DELETE') {
    throw createError({
      statusCode: 403,
      statusMessage: `API key permission "${ctx.permissionLevel}" does not allow DELETE`,
    })
  }
  // POST/PATCH/PUT/etc. — write or full
  if (ctx.permissionLevel === 'write') return
  throw createError({
    statusCode: 403,
    statusMessage: `API key permission "${ctx.permissionLevel}" does not allow ${method}`,
  })
}

export function getAuthContext(event: H3Event): AuthContext | null {
  return contextFromSession(event) || contextFromApiKey(event)
}

export function getAuthUser(event: H3Event): AuthUser | null {
  return getAuthContext(event)?.user ?? null
}

/**
 * Throws 401 if not authenticated. Returns the auth context (user + scope).
 */
export function requireAuthContext(event: H3Event): AuthContext {
  const ctx = getAuthContext(event)
  if (!ctx) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  enforceMethodPermission(event, ctx)
  return ctx
}

export function requireAuth(event: H3Event): AuthUser {
  return requireAuthContext(event).user
}

/**
 * Admin-only operations. Scoped API keys cannot use these endpoints even if
 * the underlying user is an admin — that's the whole point of restricting
 * a key to a single podcast.
 */
export function requireAdmin(event: H3Event): AuthUser {
  const ctx = requireAuthContext(event)
  if (!ctx.user.is_admin) {
    throw createError({ statusCode: 403, statusMessage: 'Admin only' })
  }
  if (ctx.restrictedPodcastIds !== null) {
    throw createError({
      statusCode: 403,
      statusMessage: 'This operation is not allowed for scoped API keys',
    })
  }
  return ctx.user
}

/**
 * Throws 401/403/404 unless the request can access the podcast. Restrictions
 * apply in order:
 *   1. Podcast must exist.
 *   2. If the API key is scoped, the podcast must be in its scope.
 *   3. The user must have access (admin OR podcast_users membership).
 */
export function requirePodcastAccess(event: H3Event, podcastSlug: string): { user: AuthUser; podcastId: number } {
  const ctx = requireAuthContext(event)
  const db = getDb()
  const podcast = db.prepare('SELECT id FROM podcasts WHERE slug = ?').get(podcastSlug) as { id: number } | undefined
  if (!podcast) {
    throw createError({ statusCode: 404, statusMessage: 'Podcast not found' })
  }
  if (ctx.restrictedPodcastIds !== null && !ctx.restrictedPodcastIds.includes(podcast.id)) {
    throw createError({ statusCode: 403, statusMessage: 'API key is not authorized for this podcast' })
  }
  if (ctx.user.is_admin) return { user: ctx.user, podcastId: podcast.id }
  const member = db.prepare('SELECT 1 FROM podcast_users WHERE podcast_id = ? AND user_id = ?').get(podcast.id, ctx.user.id)
  if (!member) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
  return { user: ctx.user, podcastId: podcast.id }
}
