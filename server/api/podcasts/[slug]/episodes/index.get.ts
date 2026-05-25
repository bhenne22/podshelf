import { defineEventHandler, getRouterParam, getQuery, createError } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import getDb from '../../../../db/index'

/**
 * GET /api/podcasts/[slug]/episodes
 *
 * Lists episodes for the podcast. Membership required.
 * Optional ?status=draft|published, ?slug=<episode-slug>, ?fields=col1,col2,...
 *
 * The default projection is the full episode row. Pass ?fields=... to opt into
 * a narrower projection — used by the downstream-site incremental sync to
 * fetch a lightweight index of (id, slug, updated_at) without paying for the
 * full description on every row. Unknown field → 400 (catches typos that
 * would otherwise silently return less data than expected).
 */

// Whitelist for ?fields=. Keep in sync with the columns added in
// server/db/schema.sql — adding a column to the table without listing it
// here means it can't be projected via ?fields=, which is the safer
// default than letting arbitrary SQL identifiers through.
const ALLOWED_FIELDS = new Set([
  'id', 'podcast_id', 'title', 'slug', 'episode_number', 'season_number',
  'description', 'audio_url', 'audio_filename', 'audio_size_bytes',
  'audio_duration_seconds', 'image_url', 'image_filename',
  'published_at', 'status', 'tags', 'guid',
  'transcript_path', 'transcript_type', 'chapters_url', 'episode_type',
  'itunes_title', 'itunes_author', 'itunes_explicit',
  'season_name', 'episode_display',
  'license_identifier', 'license_url',
  'recording_starts_at', 'recording_duration_minutes',
  'created_at', 'updated_at',
])

const DEFAULT_SELECT_COLS = `
  id, podcast_id, title, slug, episode_number, season_number,
  description, audio_url, audio_filename, audio_size_bytes,
  audio_duration_seconds, image_url, image_filename,
  published_at, status, tags, guid,
  transcript_path, transcript_type, chapters_url, episode_type,
  itunes_title, itunes_author, itunes_explicit,
  season_name, episode_display,
  license_identifier, license_url,
  recording_starts_at, recording_duration_minutes,
  created_at, updated_at
`

function resolveSelectCols(fieldsParam: string | undefined): string {
  if (!fieldsParam) return DEFAULT_SELECT_COLS
  const requested = fieldsParam.split(',').map((s) => s.trim()).filter(Boolean)
  if (requested.length === 0) return DEFAULT_SELECT_COLS
  for (const f of requested) {
    if (!ALLOWED_FIELDS.has(f)) {
      throw createError({
        statusCode: 400,
        statusMessage: `unknown field: ${f}. Allowed: ${[...ALLOWED_FIELDS].join(', ')}`,
      })
    }
  }
  return requested.join(', ')
}

export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)

  const db = getDb()
  const query = getQuery(event)

  const SELECT_COLS = resolveSelectCols(query.fields as string | undefined)

  if (query.slug) {
    return db.prepare(`
      SELECT ${SELECT_COLS}
      FROM episodes
      WHERE podcast_id = ? AND slug = ?
    `).get(podcastId, query.slug as string) || null
  }

  let sql = `
    SELECT ${SELECT_COLS}
    FROM episodes
    WHERE podcast_id = ?
  `
  const params: (string | number)[] = [podcastId]

  if (query.status) {
    const status = query.status as string
    if (!['draft', 'published', 'scheduled'].includes(status)) {
      throw createError({ statusCode: 400, statusMessage: 'status must be draft, published, or scheduled' })
    }
    sql += ' AND status = ?'
    params.push(status)
  }

  sql += `
    ORDER BY
      COALESCE(published_at, recording_starts_at, created_at) DESC,
      created_at DESC
  `

  return db.prepare(sql).all(...params)
})
