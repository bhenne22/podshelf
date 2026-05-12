import { defineEventHandler, getQuery } from 'h3'
import { requireAuthContext } from '../../utils/auth'
import getDb from '../../db/index'

/**
 * GET /api/networks
 *
 * Lists networks the caller can read. Admins see all networks. Non-admins
 * see only networks whose active-podcast set intersects their podcast_users
 * membership. A scoped API key further narrows the result to networks whose
 * podcasts overlap the key's scope.
 *
 * Optional ?podcastSlug=foo filter — returns only networks containing that
 * podcast. Used by the inline scheduling-conflict hint to discover which
 * network(s) to query without enumerating all of the user's networks.
 */
export default defineEventHandler((event) => {
  const ctx = requireAuthContext(event)
  const db = getDb()
  const query = getQuery(event)
  const podcastSlugFilter = query.podcastSlug ? String(query.podcastSlug) : null

  type Row = {
    id: number
    slug: string
    title: string
    description: string | null
    podcast_count: number
  }

  const baseSelect = `
    SELECT n.id, n.slug, n.title, n.description,
           (SELECT COUNT(*) FROM network_podcasts np2
            JOIN podcasts p2 ON p2.id = np2.podcast_id
            WHERE np2.network_id = n.id AND p2.status = 'active') AS podcast_count
    FROM networks n
  `

  let rows: Row[]

  if (ctx.user.is_admin && ctx.restrictedPodcastIds === null) {
    if (podcastSlugFilter) {
      rows = db.prepare(`
        ${baseSelect}
        WHERE EXISTS (
          SELECT 1 FROM network_podcasts np
          JOIN podcasts p ON p.id = np.podcast_id
          WHERE np.network_id = n.id AND p.slug = ? AND p.status = 'active'
        )
        ORDER BY n.title
      `).all(podcastSlugFilter) as Row[]
    } else {
      rows = db.prepare(`${baseSelect} ORDER BY n.title`).all() as Row[]
    }
  } else {
    // Networks must contain at least one podcast the caller can see.
    // For session auth: any podcast in podcast_users.
    // For scoped API keys: any podcast in the key's scope (which is already
    // a subset of the user's access).
    if (ctx.restrictedPodcastIds !== null) {
      if (ctx.restrictedPodcastIds.length === 0) return []
      const placeholders = ctx.restrictedPodcastIds.map(() => '?').join(',')
      const params: (string | number)[] = [...ctx.restrictedPodcastIds]
      let sql = `
        ${baseSelect}
        WHERE EXISTS (
          SELECT 1 FROM network_podcasts np
          JOIN podcasts p ON p.id = np.podcast_id
          WHERE np.network_id = n.id
            AND np.podcast_id IN (${placeholders})
            AND p.status = 'active'
        )
      `
      if (podcastSlugFilter) {
        sql += ` AND EXISTS (
          SELECT 1 FROM network_podcasts np3
          JOIN podcasts p3 ON p3.id = np3.podcast_id
          WHERE np3.network_id = n.id AND p3.slug = ? AND p3.status = 'active'
        )`
        params.push(podcastSlugFilter)
      }
      sql += ' ORDER BY n.title'
      rows = db.prepare(sql).all(...params) as Row[]
    } else {
      const params: (string | number)[] = [ctx.user.id]
      let sql = `
        ${baseSelect}
        WHERE EXISTS (
          SELECT 1 FROM network_podcasts np
          JOIN podcast_users pu ON pu.podcast_id = np.podcast_id
          JOIN podcasts p ON p.id = np.podcast_id
          WHERE np.network_id = n.id AND pu.user_id = ? AND p.status = 'active'
        )
      `
      if (podcastSlugFilter) {
        sql += ` AND EXISTS (
          SELECT 1 FROM network_podcasts np3
          JOIN podcasts p3 ON p3.id = np3.podcast_id
          WHERE np3.network_id = n.id AND p3.slug = ? AND p3.status = 'active'
        )`
        params.push(podcastSlugFilter)
      }
      sql += ' ORDER BY n.title'
      rows = db.prepare(sql).all(...params) as Row[]
    }
  }

  return rows
})
