import { defineEventHandler, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../../../utils/auth'
import { bumpFeedLastModified } from '../../../../../../utils/feed-cache'
import { maybeAutoTrigger } from '../../../../../../utils/github'
import { logAudit } from '../../../../../../utils/audit'
import getDb from '../../../../../../db/index'

/**
 * DELETE /api/podcasts/[slug]/episodes/[id]/people/[attachId]
 *
 * Detaches a person from a single episode without affecting other episodes.
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const epId = Number(getRouterParam(event, 'id'))
  const attachId = Number(getRouterParam(event, 'attachId'))
  const { user, podcastId } = requirePodcastAccess(event, slug)

  if (!Number.isFinite(epId) || !Number.isFinite(attachId)) {
    throw createError({ statusCode: 400, statusMessage: 'episode id and attachId required' })
  }

  const db = getDb()
  const ep = db.prepare('SELECT id, status FROM episodes WHERE id = ? AND podcast_id = ?')
    .get(epId, podcastId) as { id: number; status: string } | undefined
  if (!ep) {
    throw createError({ statusCode: 404, statusMessage: 'Episode not found' })
  }

  // Capture name before delete for the audit summary.
  const attachment = db.prepare(`
    SELECT p.name FROM episode_people ep
    JOIN people p ON p.id = ep.person_id
    WHERE ep.id = ? AND ep.episode_id = ?
  `).get(attachId, epId) as { name: string } | undefined

  const result = db.prepare(
    'DELETE FROM episode_people WHERE id = ? AND episode_id = ?'
  ).run(attachId, epId)

  if (result.changes === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Attachment not found' })
  }

  logAudit(event, {
    podcastId,
    userId: user.id,
    action: 'episode.people.detach',
    entityType: 'episode',
    entityId: epId,
    summary: `Detached ${attachment?.name ?? 'a person'} from episode`,
  })

  if (ep.status === 'published') {
    bumpFeedLastModified(podcastId)
    maybeAutoTrigger(podcastId, 'episode-people-update')
  }

  return { ok: true }
})
