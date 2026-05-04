import { defineEventHandler, getRouterParam, getQuery, createError } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import getDb from '../../../../db/index'

/**
 * GET /api/podcasts/[slug]/episodes
 *
 * Lists episodes for the podcast. Membership required.
 * Optional ?status=draft|published, ?slug=<episode-slug>.
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)

  const db = getDb()
  const query = getQuery(event)

  const SELECT_COLS = `
    id, podcast_id, title, slug, episode_number, season_number,
    description, audio_url, audio_filename, audio_size_bytes,
    audio_duration_seconds, image_url, image_filename,
    published_at, status, tags,
    transcript_path, transcript_type, chapters_url, episode_type,
    itunes_title, itunes_author, itunes_explicit,
    season_name, episode_display,
    license_identifier, license_url,
    created_at, updated_at
  `

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
      CASE WHEN published_at IS NULL THEN 1 ELSE 0 END,
      published_at DESC,
      created_at DESC
  `

  return db.prepare(sql).all(...params)
})
