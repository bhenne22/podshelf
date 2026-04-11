import { defineEventHandler } from 'h3'
import { requireAuth } from '../../utils/auth'
import getDb from '../../db/index'

export default defineEventHandler((event) => {
  requireAuth(event)

  const db = getDb()

  const { total } = db.prepare('SELECT COUNT(*) as total FROM downloads').get() as { total: number }
  const { last30Days } = db.prepare("SELECT COUNT(*) as last30Days FROM downloads WHERE downloaded_at > datetime('now', '-30 days')").get() as { last30Days: number }
  const { last7Days } = db.prepare("SELECT COUNT(*) as last7Days FROM downloads WHERE downloaded_at > datetime('now', '-7 days')").get() as { last7Days: number }

  const byEpisode = db.prepare(`
    SELECT
      e.id, e.title, e.slug, e.episode_number, e.season_number,
      COUNT(*) as total,
      SUM(CASE WHEN d.downloaded_at > datetime('now', '-30 days') THEN 1 ELSE 0 END) as last30Days
    FROM downloads d
    JOIN episodes e ON e.id = d.episode_id
    GROUP BY e.id
    ORDER BY total DESC
  `).all()

  const byDay = db.prepare(`
    SELECT date(downloaded_at) as date, COUNT(*) as count
    FROM downloads
    WHERE downloaded_at > datetime('now', '-30 days')
    GROUP BY date(downloaded_at)
    ORDER BY date ASC
  `).all()

  const byCountry = db.prepare(`
    SELECT country, COUNT(*) as count
    FROM downloads
    WHERE country IS NOT NULL AND country != ''
    GROUP BY country
    ORDER BY count DESC
    LIMIT 15
  `).all()

  return { total, last30Days, last7Days, byEpisode, byDay, byCountry }
})
