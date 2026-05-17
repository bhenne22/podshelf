import { defineEventHandler, setHeader, createError } from 'h3'
import getDb from '../../db/index'
import { renderIcsFeed, type IcsEpisode, type IcsScopeKind } from '../../utils/ics'

interface TokenRow {
  id: number
  user_id: number
  scope_type: IcsScopeKind
  scope_id: number
  revoked_at: string | null
}

interface EpisodeRow {
  id: number
  title: string
  slug: string
  description: string | null
  status: string
  published_at: string | null
  recording_starts_at: string | null
  // Pre-resolved in SQL via COALESCE(episode.duration, podcast.default) so a
  // single null here means "use the global 90-min fallback in ics.ts".
  effective_duration_minutes: number | null
  updated_at: string
  podcast_title: string
  podcast_website: string | null
}

export default defineEventHandler((event) => {
  // Nitro's `[token].ics` route binding doesn't reliably populate the token
  // param (the literal .ics in the route eats it), so parse the path
  // ourselves — same pattern as feeds/[slug].xml.ts.
  const m = (event.path || '').match(/^\/schedule\/([^/]+)\.ics(?:\?|$)/)
  const tokenStr = m?.[1]
  if (!tokenStr) {
    throw createError({ statusCode: 404, statusMessage: 'Bad calendar URL' })
  }

  const db = getDb()
  const tokenRow = db.prepare(`
    SELECT id, user_id, scope_type, scope_id, revoked_at
    FROM schedule_tokens WHERE token = ?
  `).get(tokenStr) as TokenRow | undefined

  if (!tokenRow) {
    throw createError({ statusCode: 404, statusMessage: 'Calendar not found' })
  }
  if (tokenRow.revoked_at) {
    // 410 lets Apple Calendar (and well-behaved Google clients) drop the
    // subscription gracefully instead of polling indefinitely.
    throw createError({ statusCode: 410, statusMessage: 'This calendar subscription has been revoked' })
  }

  let podcastIds: number[]
  let calendarName: string

  if (tokenRow.scope_type === 'podcast') {
    const podcast = db.prepare('SELECT id, title FROM podcasts WHERE id = ? AND status = ?')
      .get(tokenRow.scope_id, 'active') as { id: number; title: string } | undefined
    if (!podcast) {
      throw createError({ statusCode: 404, statusMessage: 'Calendar scope no longer exists' })
    }
    podcastIds = [podcast.id]
    calendarName = `${podcast.title} — Schedule`
  } else {
    const network = db.prepare('SELECT id, title FROM networks WHERE id = ?')
      .get(tokenRow.scope_id) as { id: number; title: string } | undefined
    if (!network) {
      throw createError({ statusCode: 404, statusMessage: 'Calendar scope no longer exists' })
    }
    const rows = db.prepare(`
      SELECT np.podcast_id
      FROM network_podcasts np
      JOIN podcasts p ON p.id = np.podcast_id
      WHERE np.network_id = ? AND p.status = 'active'
    `).all(network.id) as { podcast_id: number }[]
    podcastIds = rows.map((r) => r.podcast_id)
    calendarName = `${network.title} — Network Schedule`
  }

  let episodes: EpisodeRow[] = []
  if (podcastIds.length > 0) {
    const placeholders = podcastIds.map(() => '?').join(',')
    // The filter is "anything a calendar consumer would care about":
    //   - episode has a recording slot (REC event), OR
    //   - episode is scheduled or published with a publish date (DROP event)
    // Drafts without a recording slot are intentionally excluded — undated
    // events would just be calendar noise.
    episodes = db.prepare(`
      SELECT
        e.id, e.title, e.slug, e.description, e.status,
        e.published_at, e.recording_starts_at,
        COALESCE(e.recording_duration_minutes, p.recording_default_duration_minutes)
          AS effective_duration_minutes,
        e.updated_at,
        p.title   AS podcast_title,
        p.website AS podcast_website
      FROM episodes e
      JOIN podcasts p ON p.id = e.podcast_id
      WHERE e.podcast_id IN (${placeholders})
        AND (
          e.recording_starts_at IS NOT NULL
          OR (e.status IN ('scheduled','published') AND e.published_at IS NOT NULL)
        )
      ORDER BY
        COALESCE(e.recording_starts_at, e.published_at) ASC,
        e.id ASC
    `).all(...podcastIds) as EpisodeRow[]
  }

  const icsEpisodes: IcsEpisode[] = episodes.map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    status: row.status,
    published_at: row.published_at,
    recording_starts_at: row.recording_starts_at,
    recording_duration_minutes: row.effective_duration_minutes,
    updated_at: row.updated_at,
    podcast_title: row.podcast_title,
    podcast_website: row.podcast_website,
  }))

  const body = renderIcsFeed(icsEpisodes, {
    scopeKind: tokenRow.scope_type,
    calendarName,
  })

  setHeader(event, 'Content-Type', 'text/calendar; charset=utf-8')
  // Caching subscriptions aggressively confuses Apple Calendar's "refresh
  // every N minutes" behavior. Let clients control polling cadence; we
  // don't want a CDN sitting in between either.
  setHeader(event, 'Cache-Control', 'private, max-age=0, must-revalidate')
  return body
})
