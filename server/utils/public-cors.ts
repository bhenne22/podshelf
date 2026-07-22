import { setResponseHeader, type H3Event } from 'h3'
import getDb from '../db/index'

/**
 * CORS for the unauthenticated `/api/public/*` surface.
 *
 * The allowlist is derived from the `podcasts.website` column rather than a
 * new env var — every downstream static site already records its own public
 * URL there, so a new sister site becomes an allowed origin the moment its
 * podcast is configured. Nothing here grants credentials; these endpoints are
 * anonymous by design, so an echoed origin only lets the browser *read the
 * response*, which is a bare `{ ok: true }`.
 */
export function allowedSiteOrigins(): Set<string> {
  const db = getDb()
  const rows = db.prepare(`
    SELECT website FROM podcasts
    WHERE status = 'active' AND website IS NOT NULL AND website != ''
  `).all() as { website: string }[]

  const out = new Set<string>()
  for (const r of rows) {
    try {
      out.add(new URL(r.website).origin)
    } catch {
      // A malformed website value just doesn't contribute an origin.
    }
  }
  return out
}

/** Dev servers for the downstream sites run on localhost; allow them off-prod. */
function isDevOrigin(origin: string): boolean {
  if (process.env.NODE_ENV === 'production') return false
  try {
    const { hostname } = new URL(origin)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  } catch {
    return false
  }
}

/**
 * Echo the request origin when it's one we recognize. Returns whether the
 * origin was allowed so a preflight can answer accordingly.
 *
 * A request with no Origin header at all (curl, server-to-server) is left
 * alone — CORS is a browser mechanism and there's nothing to echo.
 */
export function applyPublicCors(event: H3Event, origin: string | undefined): boolean {
  setResponseHeader(event, 'Vary', 'Origin')
  if (!origin) return false

  const allowed = isDevOrigin(origin) || allowedSiteOrigins().has(origin)
  if (!allowed) return false

  setResponseHeader(event, 'Access-Control-Allow-Origin', origin)
  setResponseHeader(event, 'Access-Control-Allow-Methods', 'POST, OPTIONS')
  setResponseHeader(event, 'Access-Control-Allow-Headers', 'Content-Type')
  setResponseHeader(event, 'Access-Control-Max-Age', 86400)
  return true
}
