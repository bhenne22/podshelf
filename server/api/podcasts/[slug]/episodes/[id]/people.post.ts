import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../../utils/auth'
import { bumpFeedLastModified } from '../../../../../utils/feed-cache'
import { maybeAutoTrigger } from '../../../../../utils/github'
import { logAudit } from '../../../../../utils/audit'
import getDb from '../../../../../db/index'

/**
 * POST /api/podcasts/[slug]/episodes/[id]/people
 *
 * Body: { person_id, role?, group? }
 *
 * Attaches a person to this episode. role/group default to the person's
 * defaults at attach time, then live in episode_people NOT NULL — later
 * changes to the person's defaults won't rewrite this attachment.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const id = Number(getRouterParam(event, 'id'))
  const { user, podcastId } = requirePodcastAccess(event, slug)

  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'episode id required' })
  }

  const body = await readBody(event)
  const personId = Number(body?.person_id)
  if (!Number.isFinite(personId)) {
    throw createError({ statusCode: 400, statusMessage: 'person_id required' })
  }

  const db = getDb()
  const ep = db.prepare('SELECT id, status FROM episodes WHERE id = ? AND podcast_id = ?')
    .get(id, podcastId) as { id: number; status: string } | undefined
  if (!ep) {
    throw createError({ statusCode: 404, statusMessage: 'Episode not found' })
  }

  const person = db.prepare(`
    SELECT id, default_role, default_group FROM people
    WHERE id = ? AND podcast_id = ?
  `).get(personId, podcastId) as { id: number; default_role: string; default_group: string } | undefined
  if (!person) {
    throw createError({ statusCode: 404, statusMessage: 'Person not found in this podcast' })
  }

  // Already attached? Update role/group rather than insert a duplicate.
  const existing = db.prepare(
    'SELECT id FROM episode_people WHERE episode_id = ? AND person_id = ?'
  ).get(id, personId) as { id: number } | undefined

  const role = (body?.role && String(body.role).trim()) || person.default_role
  const group = (body?.group && String(body.group).trim()) || person.default_group

  let attachId: number
  if (existing) {
    db.prepare('UPDATE episode_people SET role = ?, "group" = ? WHERE id = ?').run(role, group, existing.id)
    attachId = existing.id
  } else {
    const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM episode_people WHERE episode_id = ?')
      .get(id) as { p: number }
    const result = db.prepare(`
      INSERT INTO episode_people (episode_id, person_id, role, "group", position)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, personId, role, group, maxPos.p + 1)
    attachId = Number(result.lastInsertRowid)
  }

  // Roster changes alter the rendered episode payload (the <podcast:person>
  // tags in the feed and the embedded people in downstream sync output), so
  // bump episodes.updated_at for the incremental-sync invariant.
  db.prepare(`UPDATE episodes SET updated_at = datetime('now') WHERE id = ?`).run(id)

  if (ep.status === 'published') {
    bumpFeedLastModified(podcastId)
    maybeAutoTrigger(podcastId, 'episode-people-update')
  }

  const personRow = db.prepare('SELECT name FROM people WHERE id = ?').get(personId) as { name: string }
  logAudit(event, {
    podcastId,
    userId: user.id,
    action: existing ? 'episode.people.update' : 'episode.people.attach',
    entityType: 'episode',
    entityId: id,
    summary: existing
      ? `Updated ${personRow.name}'s attachment (${role}/${group})`
      : `Attached ${personRow.name} (${role}) to episode`,
  })

  return db.prepare(`
    SELECT ep.id, ep.episode_id, ep.person_id, ep.role, ep."group" AS "group", ep.position,
           p.name, p.img_url, p.href
    FROM episode_people ep
    JOIN people p ON p.id = ep.person_id
    WHERE ep.id = ?
  `).get(attachId)
})
