import { defineEventHandler, getRouterParam } from 'h3'
import { requirePodcastAccess } from '../../../utils/auth'
import getDb from '../../../db/index'

/**
 * GET /api/podcasts/[slug]/dashboard
 *
 * Cheap aggregate of everything the per-podcast home page needs in one call.
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)

  const db = getDb()

  const counts = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) as published,
      SUM(CASE WHEN status = 'draft'     THEN 1 ELSE 0 END) as drafts
    FROM episodes
    WHERE podcast_id = ?
  `).get(podcastId) as { total: number; published: number; drafts: number }

  const latest_published = db.prepare(`
    SELECT id, title, slug, episode_number, season_number, published_at
    FROM episodes
    WHERE podcast_id = ? AND status = 'published' AND published_at IS NOT NULL
    ORDER BY published_at DESC
    LIMIT 1
  `).get(podcastId) || null

  const newest_draft = db.prepare(`
    SELECT id, title, slug, episode_number, season_number, created_at
    FROM episodes
    WHERE podcast_id = ? AND status = 'draft'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(podcastId) || null

  const downloads_total = db.prepare(`
    SELECT COUNT(*) as n FROM downloads d
    JOIN episodes e ON e.id = d.episode_id
    WHERE e.podcast_id = ?
  `).get(podcastId) as { n: number }

  const downloads_30d = db.prepare(`
    SELECT COUNT(*) as n FROM downloads d
    JOIN episodes e ON e.id = d.episode_id
    WHERE e.podcast_id = ? AND d.downloaded_at > datetime('now', '-30 days')
  `).get(podcastId) as { n: number }

  const downloads_7d = db.prepare(`
    SELECT COUNT(*) as n FROM downloads d
    JOIN episodes e ON e.id = d.episode_id
    WHERE e.podcast_id = ? AND d.downloaded_at > datetime('now', '-7 days')
  `).get(podcastId) as { n: number }

  return {
    counts: {
      total: counts.total ?? 0,
      published: counts.published ?? 0,
      drafts: counts.drafts ?? 0,
    },
    latest_published,
    newest_draft,
    downloads: {
      total: downloads_total.n,
      last_30d: downloads_30d.n,
      last_7d: downloads_7d.n,
    },
  }
})
