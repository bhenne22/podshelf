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
  apiKeyId: number | null
}

export const SESSION_COOKIE_NAME = 'session'

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
  return { user: row, restrictedPodcastIds: null, permissionLevel: null, apiKeyId: null }
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
    apiKeyId: row.key_id,
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
  // Stash so audit logging can stamp api_key_id without every handler
  // having to thread the value through manually.
  event.context.apiKeyId = ctx.apiKeyId
  return ctx
}

export function requireAuth(event: H3Event): AuthUser {
  return requireAuthContext(event).user
}

/**
 * Operations that must not be reachable with an API key — API-key management
 * itself. Minting or widening a key from another key is a privilege-escalation
 * path: a scoped or read/write key could hand itself an unrestricted `full`
 * key, defeating its own ceiling. These endpoints require an interactive
 * session (cookie auth, where permissionLevel is null).
 */
export function requireSessionAuth(event: H3Event): AuthUser {
  const ctx = requireAuthContext(event)
  if (ctx.permissionLevel !== null) {
    throw createError({
      statusCode: 403,
      statusMessage: 'API-key management requires an interactive login session, not an API key',
    })
  }
  return ctx.user
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
 * Active podcast IDs belonging to a network. Soft-deleted podcasts are
 * filtered out (status != 'active'); the join row stays so a future restore
 * re-attaches them automatically.
 */
export function getNetworkPodcastIds(networkId: number): number[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT np.podcast_id
    FROM network_podcasts np
    JOIN podcasts p ON p.id = np.podcast_id
    WHERE np.network_id = ? AND p.status = 'active'
    ORDER BY np.position, p.title
  `).all(networkId) as { podcast_id: number }[]
  return rows.map((r) => r.podcast_id)
}

/**
 * Distinct network IDs the user can see, derived from podcast_users —
 * if you're in any podcast in a network, you can read that network.
 */
export function getUserNetworkIds(userId: number): number[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT DISTINCT np.network_id
    FROM network_podcasts np
    JOIN podcast_users pu ON pu.podcast_id = np.podcast_id
    JOIN podcasts p ON p.id = np.podcast_id
    WHERE pu.user_id = ? AND p.status = 'active'
  `).all(userId) as { network_id: number }[]
  return rows.map((r) => r.network_id)
}

/**
 * Throws 401/403/404 unless the request can read the network. Mirrors the
 * order-of-restrictions style of requirePodcastAccess:
 *   1. Network must exist.
 *   2. If the API key is scoped, its scope must intersect the network's
 *      active podcasts. The intersection is returned as effectivePodcastIds
 *      so handlers never widen a scoped key's data view via a network.
 *   3. Admin → allow.
 *   4. Otherwise the user must be a member of at least one podcast in the
 *      network.
 */
export function requireNetworkReadAccess(
  event: H3Event,
  networkSlug: string,
): { user: AuthUser; networkId: number; podcastIds: number[]; effectivePodcastIds: number[] } {
  const ctx = requireAuthContext(event)
  const db = getDb()
  const network = db.prepare('SELECT id FROM networks WHERE slug = ?').get(networkSlug) as { id: number } | undefined
  if (!network) {
    throw createError({ statusCode: 404, statusMessage: 'Network not found' })
  }
  const podcastIds = getNetworkPodcastIds(network.id)

  let effectivePodcastIds = podcastIds
  if (ctx.restrictedPodcastIds !== null) {
    effectivePodcastIds = podcastIds.filter((id) => ctx.restrictedPodcastIds!.includes(id))
    if (effectivePodcastIds.length === 0) {
      throw createError({ statusCode: 403, statusMessage: 'API key is not authorized for this network' })
    }
  }

  if (ctx.user.is_admin) {
    return { user: ctx.user, networkId: network.id, podcastIds, effectivePodcastIds }
  }

  if (podcastIds.length === 0) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
  const placeholders = podcastIds.map(() => '?').join(',')
  const member = db.prepare(
    `SELECT 1 FROM podcast_users WHERE user_id = ? AND podcast_id IN (${placeholders})`
  ).get(ctx.user.id, ...podcastIds)
  if (!member) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
  return { user: ctx.user, networkId: network.id, podcastIds, effectivePodcastIds }
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
