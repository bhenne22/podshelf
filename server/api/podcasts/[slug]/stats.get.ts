import { defineEventHandler, getRouterParam } from 'h3'
import { requirePodcastAccess } from '../../../utils/auth'
import getDb from '../../../db/index'

/**
 * GET /api/podcasts/[slug]/stats
 *
 * Download analytics scoped to a single podcast.
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)

  const db = getDb()

  const { total } = db.prepare(`
    SELECT COUNT(*) as total FROM downloads d
    JOIN episodes e ON e.id = d.episode_id
    WHERE e.podcast_id = ?
  `).get(podcastId) as { total: number }

  const { last30Days } = db.prepare(`
    SELECT COUNT(*) as last30Days FROM downloads d
    JOIN episodes e ON e.id = d.episode_id
    WHERE e.podcast_id = ? AND d.downloaded_at > datetime('now', '-30 days')
  `).get(podcastId) as { last30Days: number }

  const { last7Days } = db.prepare(`
    SELECT COUNT(*) as last7Days FROM downloads d
    JOIN episodes e ON e.id = d.episode_id
    WHERE e.podcast_id = ? AND d.downloaded_at > datetime('now', '-7 days')
  `).get(podcastId) as { last7Days: number }

  const byEpisode = db.prepare(`
    SELECT
      e.id, e.title, e.slug, e.episode_number, e.season_number,
      COUNT(*) as total,
      SUM(CASE WHEN d.downloaded_at > datetime('now', '-30 days') THEN 1 ELSE 0 END) as last30Days
    FROM downloads d
    JOIN episodes e ON e.id = d.episode_id
    WHERE e.podcast_id = ?
    GROUP BY e.id
    ORDER BY total DESC
  `).all(podcastId)

  const byDay = db.prepare(`
    SELECT date(d.downloaded_at) as date, COUNT(*) as count
    FROM downloads d
    JOIN episodes e ON e.id = d.episode_id
    WHERE e.podcast_id = ? AND d.downloaded_at > datetime('now', '-30 days')
    GROUP BY date(d.downloaded_at)
    ORDER BY date ASC
  `).all(podcastId)

  const byCountry = db.prepare(`
    SELECT d.country, COUNT(*) as count
    FROM downloads d
    JOIN episodes e ON e.id = d.episode_id
    WHERE e.podcast_id = ? AND d.country IS NOT NULL AND d.country != ''
    GROUP BY d.country
    ORDER BY count DESC
    LIMIT 15
  `).all(podcastId)

  return { total, last30Days, last7Days, byEpisode, byDay, byCountry }
})
