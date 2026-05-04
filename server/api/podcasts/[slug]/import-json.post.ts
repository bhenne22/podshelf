import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../utils/auth'
import { logAudit } from '../../../utils/audit'
import { bumpFeedLastModified } from '../../../utils/feed-cache'
import { maybeAutoTrigger } from '../../../utils/github'
import getDb from '../../../db/index'

interface ArchiveEpisode {
  id: number
  title: string
  slug: string
  episode_number: number | null
  season_number: number | null
  description: string | null
  audio_url: string | null
  audio_filename: string | null
  audio_size_bytes: number | null
  audio_duration_seconds: number | null
  image_url: string | null
  image_filename: string | null
  published_at: string | null
  status: string
  tags: string | null
  transcript_path: string | null
  transcript_type: string | null
  chapters_url: string | null
  guid: string | null
  episode_type: string | null
  itunes_title: string | null
  itunes_author: string | null
  itunes_explicit: string | null
  season_name: string | null
  episode_display: string | null
  license_identifier: string | null
  license_url: string | null
}

interface ArchivePerson {
  id: number
  name: string
  img_url: string | null
  href: string | null
  default_role: string
  default_group: string
  auto_attach: number
}

interface ArchiveEpisodePerson {
  episode_id: number
  person_id: number
  role: string
  group: string
  position: number
}

interface ArchiveSlugAlias {
  old_slug: string
  created_at: string
}

interface PodcastArchive {
  schema_version: number
  podcast: Record<string, unknown>
  episodes: ArchiveEpisode[]
  people: ArchivePerson[]
  episode_people: ArchiveEpisodePerson[]
  slug_aliases: ArchiveSlugAlias[]
}

const SUPPORTED_SCHEMA_VERSIONS = [1]

const PODCAST_RESTORE_FIELDS = [
  'description', 'author', 'email', 'image_url', 'language',
  'copyright', 'category', 'explicit', 'website', 'audio_tracking_prefix',
  'itunes_type', 'podcast_locked', 'itunes_complete', 'itunes_block',
  'funding_url', 'funding_label', 'verify_txt', 'license_identifier', 'license_url',
  'episode_title_template', 'episode_description_template', 'guid',
] as const

/**
 * POST /api/podcasts/[slug]/import-json
 *
 * Body: a Podshelf JSON archive (output of `GET .../export.json`).
 *
 * Restores everything except secrets (storage / github token / webhook URL),
 * which the user re-configures on the target instance. Empty-podcast only —
 * same constraint as the RSS importer.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { user, podcastId } = requirePodcastAccess(event, slug)

  const body = await readBody<PodcastArchive>(event)
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'JSON archive body required' })
  }
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(body.schema_version)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Unsupported archive schema_version (${body.schema_version}); this Podshelf supports ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}`,
    })
  }
  if (!body.podcast || !Array.isArray(body.episodes)) {
    throw createError({ statusCode: 400, statusMessage: 'Archive missing required `podcast` or `episodes`' })
  }

  const db = getDb()

  const { count } = db.prepare('SELECT COUNT(*) as count FROM episodes WHERE podcast_id = ?')
    .get(podcastId) as { count: number }
  if (count > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Podcast already has episodes; JSON import is only available for empty podcasts.',
    })
  }

  const sourcePodcast = body.podcast as Record<string, unknown>

  const episodeIdMap = new Map<number, number>() // source id → new id
  const personIdMap = new Map<number, number>() // source id → new id

  // Restore podcast settings: only into empty/default fields, mirror the
  // RSS importer's "user edits win" rule. The export deliberately omits
  // secrets; re-configure storage/github/webhook on the new instance.
  const SCHEMA_DEFAULTS: Record<string, string> = {
    itunes_type: 'episodic',
    podcast_locked: 'no',
    itunes_complete: 'no',
    itunes_block: 'no',
    category: 'Society & Culture',
    language: 'en',
    explicit: 'false',
  }
  const currentPodcast = db.prepare(`
    SELECT description, author, email, image_url, language, copyright,
           category, explicit, website, audio_tracking_prefix,
           itunes_type, podcast_locked, itunes_complete, itunes_block,
           funding_url, funding_label, verify_txt, license_identifier, license_url,
           episode_title_template, episode_description_template, guid
    FROM podcasts WHERE id = ?
  `).get(podcastId) as Record<string, string | null>

  const settingsBackfilled: string[] = []
  const setClauses: string[] = []
  const setValues: Record<string, unknown> = { id: podcastId }
  for (const field of PODCAST_RESTORE_FIELDS) {
    const sourceVal = sourcePodcast[field]
    if (sourceVal === null || sourceVal === undefined) continue
    const currentVal = currentPodcast[field]
    const isEmpty = currentVal === null || currentVal === '' || currentVal === SCHEMA_DEFAULTS[field as string]
    if (isEmpty) {
      setClauses.push(`${field} = @${field}`)
      setValues[field] = sourceVal
      settingsBackfilled.push(field)
    }
  }

  let importedEpisodes = 0
  let importedPeople = 0
  let importedAttachments = 0
  let importedAliases = 0

  const insertEpisode = db.prepare(`
    INSERT INTO episodes (
      podcast_id, title, slug, episode_number, season_number,
      description, audio_url, audio_filename, audio_size_bytes,
      audio_duration_seconds, image_url, image_filename,
      published_at, status, tags,
      transcript_path, transcript_type, chapters_url,
      guid, episode_type,
      itunes_title, itunes_author, itunes_explicit,
      season_name, episode_display,
      license_identifier, license_url
    ) VALUES (
      @podcast_id, @title, @slug, @episode_number, @season_number,
      @description, @audio_url, @audio_filename, @audio_size_bytes,
      @audio_duration_seconds, @image_url, @image_filename,
      @published_at, @status, @tags,
      @transcript_path, @transcript_type, @chapters_url,
      @guid, @episode_type,
      @itunes_title, @itunes_author, @itunes_explicit,
      @season_name, @episode_display,
      @license_identifier, @license_url
    )
  `)

  const insertPerson = db.prepare(`
    INSERT INTO people (podcast_id, name, img_url, href, default_role, default_group, auto_attach)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  const insertAttach = db.prepare(`
    INSERT INTO episode_people (episode_id, person_id, role, "group", position)
    VALUES (?, ?, ?, ?, ?)
  `)

  const insertAlias = db.prepare(`
    INSERT OR IGNORE INTO slug_aliases (podcast_id, old_slug, created_at) VALUES (?, ?, ?)
  `)

  db.transaction(() => {
    if (setClauses.length > 0) {
      db.prepare(`UPDATE podcasts SET ${setClauses.join(', ')}, updated_at = datetime('now') WHERE id = @id`).run(setValues)
    }

    // Episode slugs in the archive may collide with the (empty) target's
    // generated slugs only in the suffix-2 case; guarantee uniqueness as we go.
    const seen = new Set<string>()
    function uniqueSlug(base: string): string {
      let candidate = base || 'episode'
      let suffix = 2
      while (
        seen.has(candidate) ||
        db.prepare('SELECT 1 FROM episodes WHERE podcast_id = ? AND slug = ?').get(podcastId, candidate)
      ) {
        candidate = `${base}-${suffix}`
        suffix++
      }
      seen.add(candidate)
      return candidate
    }

    for (const ep of body.episodes) {
      const finalSlug = uniqueSlug(ep.slug)
      const validStatus = ['draft', 'published', 'scheduled'].includes(ep.status) ? ep.status : 'draft'
      const validEpType = ['full', 'trailer', 'bonus'].includes(ep.episode_type ?? '') ? ep.episode_type : 'full'
      const result = insertEpisode.run({
        podcast_id: podcastId,
        title: ep.title,
        slug: finalSlug,
        episode_number: ep.episode_number,
        season_number: ep.season_number,
        description: ep.description,
        audio_url: ep.audio_url,
        audio_filename: ep.audio_filename,
        audio_size_bytes: ep.audio_size_bytes,
        audio_duration_seconds: ep.audio_duration_seconds,
        image_url: ep.image_url,
        image_filename: ep.image_filename,
        published_at: ep.published_at,
        status: validStatus,
        tags: ep.tags,
        transcript_path: ep.transcript_path,
        transcript_type: ep.transcript_type,
        chapters_url: ep.chapters_url,
        guid: ep.guid,
        episode_type: validEpType,
        itunes_title: ep.itunes_title,
        itunes_author: ep.itunes_author,
        itunes_explicit: ep.itunes_explicit,
        season_name: ep.season_name,
        episode_display: ep.episode_display,
        license_identifier: ep.license_identifier,
        license_url: ep.license_url,
      })
      episodeIdMap.set(ep.id, Number(result.lastInsertRowid))
      importedEpisodes++
    }

    for (const p of body.people || []) {
      const result = insertPerson.run(
        podcastId, p.name, p.img_url, p.href, p.default_role, p.default_group, p.auto_attach ? 1 : 0,
      )
      personIdMap.set(p.id, Number(result.lastInsertRowid))
      importedPeople++
    }

    for (const att of body.episode_people || []) {
      const newEpId = episodeIdMap.get(att.episode_id)
      const newPersonId = personIdMap.get(att.person_id)
      if (!newEpId || !newPersonId) continue
      insertAttach.run(newEpId, newPersonId, att.role, att.group, att.position)
      importedAttachments++
    }

    for (const a of body.slug_aliases || []) {
      // INSERT OR IGNORE — collisions with another podcast's reserved alias
      // are silently dropped rather than failing the whole import.
      const result = insertAlias.run(podcastId, a.old_slug, a.created_at || new Date().toISOString())
      if (result.changes > 0) importedAliases++
    }
  })()

  bumpFeedLastModified(podcastId)
  if (importedEpisodes > 0) {
    maybeAutoTrigger(podcastId, 'json-import')
  }

  logAudit({
    podcastId,
    userId: user.id,
    action: 'podcast.import-json',
    entityType: 'podcast',
    entityId: podcastId,
    summary: `Imported Podshelf archive: ${importedEpisodes} episode${importedEpisodes === 1 ? '' : 's'}, ${importedPeople} people`,
    details: {
      episodes: importedEpisodes,
      people: importedPeople,
      attachments: importedAttachments,
      slug_aliases: importedAliases,
      settings_backfilled: settingsBackfilled,
    },
  })

  return {
    schema_version: body.schema_version,
    imported: {
      episodes: importedEpisodes,
      people: importedPeople,
      episode_people: importedAttachments,
      slug_aliases: importedAliases,
    },
    settings_backfilled: settingsBackfilled,
  }
})
