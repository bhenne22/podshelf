import { defineEventHandler, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import { bumpFeedLastModified } from '../../../../utils/feed-cache'
import { logAudit } from '../../../../utils/audit'
import getDb from '../../../../db/index'

/**
 * DELETE /api/podcasts/[slug]/people/[id]
 *
 * Removes a person from the roster. Cascade drops every episode_people
 * row referencing this person, so the person disappears from past episodes
 * too — preferable to leaving dangling references in the feed.
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const id = Number(getRouterParam(event, 'id'))
  const { user, podcastId } = requirePodcastAccess(event, slug)

  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'person id required' })
  }

  const db = getDb()
  const existing = db.prepare('SELECT id, name FROM people WHERE id = ? AND podcast_id = ?')
    .get(id, podcastId) as { id: number; name: string } | undefined
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Person not found' })
  }

  // Bump episodes.updated_at on attached episodes BEFORE the person delete —
  // the FK CASCADE on episode_people wipes the rows we'd use to find affected
  // episodes, so we have to capture the set while it still exists.
  db.prepare(`
    UPDATE episodes SET updated_at = datetime('now')
    WHERE id IN (SELECT episode_id FROM episode_people WHERE person_id = ?)
  `).run(id)

  db.prepare('DELETE FROM people WHERE id = ?').run(id)
  bumpFeedLastModified(podcastId)

  logAudit(event, {
    podcastId,
    userId: user.id,
    action: 'people.delete',
    entityType: 'person',
    entityId: id,
    summary: `Removed ${existing.name} from roster`,
  })

  return { ok: true }
})
