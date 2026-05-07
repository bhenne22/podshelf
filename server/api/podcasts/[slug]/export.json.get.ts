import { defineEventHandler, getRouterParam, setHeader } from 'h3'
import { requirePodcastAccess } from '../../../utils/auth'
import getDb from '../../../db/index'

const SCHEMA_VERSION = 1

/**
 * GET /api/podcasts/[slug]/export.json
 *
 * Full Podshelf archive of this podcast — settings, episodes (all
 * statuses), people roster, episode_people attachments, slug aliases.
 * Excludes: secrets (storage/github/webhook-url), members, api_keys,
 * audit_log, downloads. Importable into another Podshelf instance via
 * `POST /api/podcasts/[slug]/import-json` on an empty target podcast.
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)

  const db = getDb()

  const podcast = db.prepare(`
    SELECT
      slug, title, description, author, email, image_url, language,
      copyright, category, explicit, website, audio_tracking_prefix,
      itunes_type, podcast_locked, itunes_complete, itunes_block,
      funding_url, funding_label, verify_txt, license_identifier, license_url,
      episode_title_template, episode_description_template,
      guid, status, created_at, updated_at,
      webhook_format, webhook_enabled,
      github_owner, github_repo, github_event_type, github_auto_trigger
    FROM podcasts WHERE id = ?
  `).get(podcastId)

  const episodes = db.prepare(`
    SELECT
      id, title, slug, episode_number, season_number,
      description, audio_url, audio_filename, audio_size_bytes,
      audio_duration_seconds, image_url, image_filename,
      published_at, status, tags,
      transcript_path, transcript_type, chapters_url,
      guid, episode_type,
      itunes_title, itunes_author, itunes_explicit,
      season_name, episode_display,
      license_identifier, license_url,
      created_at, updated_at
    FROM episodes
    WHERE podcast_id = ?
    ORDER BY id
  `).all(podcastId)

  const people = db.prepare(`
    SELECT id, name, img_url, href, default_role, default_group, auto_attach,
           created_at, updated_at
    FROM people WHERE podcast_id = ?
    ORDER BY id
  `).all(podcastId)

  const episodePeople = db.prepare(`
    SELECT episode_id, person_id, role, "group" AS "group", position
    FROM episode_people ep
    WHERE ep.episode_id IN (SELECT id FROM episodes WHERE podcast_id = ?)
    ORDER BY episode_id, position, id
  `).all(podcastId)

  const slugAliases = db.prepare(`
    SELECT old_slug, created_at FROM slug_aliases WHERE podcast_id = ? ORDER BY id
  `).all(podcastId)

  const archive = {
    schema_version: SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    exported_by: 'podshelf',
    source_instance: (process.env.SITE_URL || (useRuntimeConfig().public.siteUrl as string) || '').replace(/\/+$/, ''),
    podcast,
    episodes,
    people,
    episode_people: episodePeople,
    slug_aliases: slugAliases,
  }

  const filename = `${slug}.podshelf.json`
  setHeader(event, 'Content-Type', 'application/json; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="${filename}"`)
  return archive
})
