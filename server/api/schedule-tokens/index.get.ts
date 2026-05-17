import { defineEventHandler } from 'h3'
import { requireAuth } from '../../utils/auth'
import getDb from '../../db/index'

interface TokenRow {
  id: number
  token: string
  scope_type: string
  scope_id: number
  label: string | null
  created_at: string
  revoked_at: string | null
  scope_slug: string | null
  scope_title: string | null
}

/**
 * GET /api/schedule-tokens
 *
 * Lists the current user's calendar-subscribe tokens (revoked rows
 * included, so the UI can show "revoked on Y" entries). Each token resolves
 * its scope row at list time so the UI doesn't have to chase IDs.
 *
 * The opaque `token` value IS returned here — these aren't secrets in the
 * way an API key is; the URL embedding the token is the share unit, so
 * the user re-copying it from this page is the expected flow.
 */
export default defineEventHandler((event) => {
  const user = requireAuth(event)
  const db = getDb()

  const rows = db.prepare(`
    SELECT
      st.id, st.token, st.scope_type, st.scope_id, st.label,
      st.created_at, st.revoked_at,
      CASE st.scope_type
        WHEN 'podcast' THEN (SELECT slug  FROM podcasts WHERE id = st.scope_id)
        WHEN 'network' THEN (SELECT slug  FROM networks WHERE id = st.scope_id)
      END AS scope_slug,
      CASE st.scope_type
        WHEN 'podcast' THEN (SELECT title FROM podcasts WHERE id = st.scope_id)
        WHEN 'network' THEN (SELECT title FROM networks WHERE id = st.scope_id)
      END AS scope_title
    FROM schedule_tokens st
    WHERE st.user_id = ?
    ORDER BY st.created_at DESC
  `).all(user.id) as TokenRow[]

  return rows
})
