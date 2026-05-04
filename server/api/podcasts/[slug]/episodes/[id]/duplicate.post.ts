import { defineEventHandler, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../../utils/auth'
import { logAudit } from '../../../../../utils/audit'
import getDb from '../../../../../db/index'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * POST /api/podcasts/[slug]/episodes/[id]/duplicate
 *
 * Clone an episode into a new draft. Carries over the per-show defaults
 * (description, tags, image_url, season, type, itunes overrides, license)
 * and copies people attachments — those are the things you'd otherwise
 * have to re-enter for the next ep. Clears anything episode-specific:
 * audio, chapters, transcript, episode number, GUID, published date.
 */
export default defineEventHandler((event) => {
  const slugParam = getRouterParam(event, 'slug') as string
  const sourceId = Number(getRouterParam(event, 'id'))
  const { user, podcastId } = requirePodcastAccess(event, slugParam)

  if (!Number.isFinite(sourceId)) {
    throw createError({ statusCode: 400, statusMessage: 'episode id required' })
  }

  const db = getDb()
  const source = db.prepare(`
    SELECT id, title, slug, description, tags, image_url, image_filename,
           season_number, season_name, episode_type, itunes_title,
           itunes_author, itunes_explicit, license_identifier, license_url
    FROM episodes WHERE id = ? AND podcast_id = ?
  `).get(sourceId, podcastId) as {
    id: number; title: string; slug: string;
    description: string | null; tags: string | null;
    image_url: string | null; image_filename: string | null;
    season_number: number | null; season_name: string | null;
    episode_type: string | null; itunes_title: string | null;
    itunes_author: string | null; itunes_explicit: string | null;
    license_identifier: string | null; license_url: string | null;
  } | undefined

  if (!source) {
    throw createError({ statusCode: 404, statusMessage: 'Episode not found' })
  }

  const newTitle = `${source.title} (Copy)`
  const baseSlug = slugify(`${source.slug}-copy`) || `${source.slug}-copy`
  let newSlug = baseSlug
  let suffix = 2
  while (db.prepare('SELECT 1 FROM episodes WHERE podcast_id = ? AND slug = ?').get(podcastId, newSlug)) {
    newSlug = `${baseSlug}-${suffix}`
    suffix++
  }

  const newId = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO episodes (
        podcast_id, title, slug, status,
        description, tags, image_url, image_filename,
        season_number, season_name, episode_type,
        itunes_title, itunes_author, itunes_explicit,
        license_identifier, license_url
      ) VALUES (
        @podcast_id, @title, @slug, 'draft',
        @description, @tags, @image_url, @image_filename,
        @season_number, @season_name, @episode_type,
        @itunes_title, @itunes_author, @itunes_explicit,
        @license_identifier, @license_url
      )
    `).run({
      podcast_id: podcastId,
      title: newTitle,
      slug: newSlug,
      description: source.description,
      tags: source.tags,
      image_url: source.image_url,
      image_filename: source.image_filename,
      season_number: source.season_number,
      season_name: source.season_name,
      episode_type: source.episode_type ?? 'full',
      itunes_title: source.itunes_title,
      itunes_author: source.itunes_author,
      itunes_explicit: source.itunes_explicit,
      license_identifier: source.license_identifier,
      license_url: source.license_url,
    })
    const id = Number(result.lastInsertRowid)

    // Carry forward people attachments (frozen role/group at duplicate time
    // — same rule as fresh attaches; later edits to defaults don't rewrite).
    const attachments = db.prepare(`
      SELECT person_id, role, "group" AS "group", position
      FROM episode_people WHERE episode_id = ? ORDER BY position, id
    `).all(sourceId) as { person_id: number; role: string; group: string; position: number }[]
    if (attachments.length > 0) {
      const insertAttach = db.prepare(`
        INSERT INTO episode_people (episode_id, person_id, role, "group", position)
        VALUES (?, ?, ?, ?, ?)
      `)
      for (const a of attachments) {
        insertAttach.run(id, a.person_id, a.role, a.group, a.position)
      }
    }

    return id
  })()

  logAudit({
    podcastId,
    userId: user.id,
    action: 'episode.duplicate',
    entityType: 'episode',
    entityId: newId,
    summary: `Duplicated "${source.title}" → "${newTitle}"`,
    details: { source_id: sourceId, new_slug: newSlug },
  })

  // Doesn't fire firePublishEvent — the new episode is always a draft.
  event.node.res.statusCode = 201
  return db.prepare('SELECT * FROM episodes WHERE id = ?').get(newId)
})
