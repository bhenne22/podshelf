import { defineEventHandler, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../../utils/auth'
import getDb from '../../../../../db/index'

/**
 * GET /api/podcasts/[slug]/episodes/[id]/people
 *
 * Lists every person attached to this episode, with the role/group frozen
 * at attach time and the person's current name/img/href.
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const id = Number(getRouterParam(event, 'id'))
  const { podcastId } = requirePodcastAccess(event, slug)

  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'episode id required' })
  }

  const db = getDb()
  const ep = db.prepare('SELECT id FROM episodes WHERE id = ? AND podcast_id = ?').get(id, podcastId)
  if (!ep) {
    throw createError({ statusCode: 404, statusMessage: 'Episode not found' })
  }

  return db.prepare(`
    SELECT ep.id, ep.episode_id, ep.person_id, ep.role, ep."group" AS "group", ep.position,
           p.name, p.img_url, p.href
    FROM episode_people ep
    JOIN people p ON p.id = ep.person_id
    WHERE ep.episode_id = ?
    ORDER BY ep.position, ep.id
  `).all(id)
})
