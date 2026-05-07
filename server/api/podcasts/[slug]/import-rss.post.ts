import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../utils/auth'
import { parsePodcastFeed } from '../../../utils/rss-parser'
import { maybeAutoTrigger } from '../../../utils/github'
import { bumpFeedLastModified } from '../../../utils/feed-cache'
import { logAudit } from '../../../utils/audit'
import getDb from '../../../db/index'

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
 * POST /api/podcasts/[slug]/import-rss
 *
 * Body: { feed_url }
 *
 * One-shot import for podcast migrations. Refuses to run if the podcast
 * already has any episodes — this is for transferring existing shows
 * onto Podshelf, not for ongoing syncing.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { user, podcastId } = requirePodcastAccess(event, slug)

  const body = await readBody(event)
  const feedUrl = String(body?.feed_url || '').trim()

  if (!/^https?:\/\//i.test(feedUrl)) {
    throw createError({ statusCode: 400, statusMessage: 'feed_url must start with http:// or https://' })
  }

  const db = getDb()

  const { count } = db.prepare('SELECT COUNT(*) as count FROM episodes WHERE podcast_id = ?')
    .get(podcastId) as { count: number }
  if (count > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Podcast already has episodes; RSS import is only available for empty podcasts.',
    })
  }

  let xml: string
  try {
    const res = await fetch(feedUrl, { headers: { 'User-Agent': 'Podshelf-Importer/1.0' } })
    if (!res.ok) {
      throw createError({
        statusCode: 400,
        statusMessage: `Feed fetch returned ${res.status} ${res.statusText}`,
      })
    }
    xml = await res.text()
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err) throw err
    throw createError({
      statusCode: 400,
      statusMessage: err instanceof Error ? `Failed to fetch feed: ${err.message}` : 'Failed to fetch feed',
    })
  }

  let feed
  try {
    feed = parsePodcastFeed(xml)
  } catch (err: unknown) {
    throw createError({
      statusCode: 400,
      statusMessage: err instanceof Error ? err.message : 'Failed to parse RSS feed',
    })
  }

  const seenSlugs = new Set<string>()
  function uniqueSlug(base: string): string {
    let candidate = base || `episode-${Date.now()}`
    let suffix = 2
    while (
      seenSlugs.has(candidate) ||
      db.prepare('SELECT 1 FROM episodes WHERE podcast_id = ? AND slug = ?').get(podcastId, candidate)
    ) {
      candidate = `${base}-${suffix}`
      suffix++
    }
    seenSlugs.add(candidate)
    return candidate
  }

  const insert = db.prepare(`
    INSERT INTO episodes (
      podcast_id, title, slug, episode_number, season_number,
      description, audio_url, audio_size_bytes, audio_duration_seconds,
      published_at, status, tags, guid, episode_type,
      transcript_path, transcript_type, chapters_url, image_url,
      itunes_title, itunes_author, itunes_explicit,
      season_name, episode_display,
      license_identifier, license_url
    ) VALUES (
      @podcast_id, @title, @slug, @episode_number, @season_number,
      @description, @audio_url, @audio_size_bytes, @audio_duration_seconds,
      @published_at, 'published', NULL, @guid, @episode_type,
      @transcript_path, @transcript_type, @chapters_url, @image_url,
      @itunes_title, @itunes_author, @itunes_explicit,
      @season_name, @episode_display,
      @license_identifier, @license_url
    )
  `)

  // Refuse to persist a published_at that doesn't include seconds. The
  // parser is supposed to always emit full ISO, but if it ever returned a
  // truncated value we'd rather store NULL and let the user fix it than
  // commit a half-formed timestamp that other code paths might widen.
  function safePubDate(s: string | null): string | null {
    if (!s) return null
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s) ? s : null
  }

  // People are added as one-off rows on import — no roster pre-existing here.
  // Same name + role inferred from item-level entries are deduped by name to
  // avoid creating five "Jane Doe" records when she appears in five episodes.
  const findPersonByName = db.prepare(
    'SELECT id FROM people WHERE podcast_id = ? AND name = ? COLLATE NOCASE'
  )
  const insertPerson = db.prepare(`
    INSERT INTO people (podcast_id, name, img_url, href, default_role, default_group, auto_attach)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const insertEpisodePerson = db.prepare(`
    INSERT INTO episode_people (episode_id, person_id, role, "group", position)
    VALUES (?, ?, ?, ?, ?)
  `)

  function ensurePerson(name: string, defaultRole: string, defaultGroup: string, img: string | null, href: string | null, autoAttach: number): number {
    const existing = findPersonByName.get(podcastId, name) as { id: number } | undefined
    if (existing) return existing.id
    const result = insertPerson.run(podcastId, name, img, href, defaultRole, defaultGroup, autoAttach)
    return Number(result.lastInsertRowid)
  }

  const tx = db.transaction((items: typeof feed.items) => {
    let imported = 0
    let skipped = 0
    let unnumbered = 0
    let httpImages = 0
    for (const item of items) {
      if (!item.audio_url) {
        skipped++
        continue
      }
      if (item.episode_number === null) unnumbered++
      if (item.image_url && /^http:\/\//i.test(item.image_url)) httpImages++
      const slug = uniqueSlug(slugify(item.title))
      const result = insert.run({
        podcast_id: podcastId,
        title: item.title,
        slug,
        episode_number: item.episode_number,
        season_number: item.season_number,
        description: item.description,
        audio_url: item.audio_url,
        audio_size_bytes: item.audio_size_bytes,
        audio_duration_seconds: item.audio_duration_seconds,
        published_at: safePubDate(item.pubDate),
        guid: item.guid,
        episode_type: item.episode_type || 'full',
        transcript_path: item.transcript_url,
        transcript_type: item.transcript_type,
        chapters_url: item.chapters_url,
        image_url: item.image_url,
        itunes_title: item.itunes_title,
        itunes_author: item.itunes_author,
        itunes_explicit: item.itunes_explicit,
        season_name: item.season_name,
        episode_display: item.episode_display,
        license_identifier: item.license_identifier,
        license_url: item.license_url,
      })

      const episodeId = Number(result.lastInsertRowid)
      let pos = 0
      for (const person of item.people) {
        const personId = ensurePerson(person.name, person.role, person.group, person.img, person.href, 0)
        insertEpisodePerson.run(episodeId, personId, person.role, person.group, pos++)
      }
      imported++
    }
    return { imported, skipped, unnumbered, httpImages }
  })

  // Channel-level <podcast:person> are the show's regular cast; create them
  // up front with auto_attach=1 so future episodes inherit them.
  if (feed.people.length > 0) {
    db.transaction(() => {
      for (const person of feed.people) {
        ensurePerson(person.name, person.role, person.group, person.img, person.href, 1)
      }
    })()
  }

  const { imported, skipped, unnumbered, httpImages } = tx(feed.items)
  const channelImageIsHttp = !!feed.image_url && /^http:\/\//i.test(feed.image_url)

  // Preserve the source feed's channel <podcast:guid> so existing
  // subscribers stay subscribed when they re-point their app at our feed.
  // The importer only runs on empty podcasts, so overwriting any GUID we
  // had previously lazy-computed is safe (no one's subscribed yet).
  if (feed.podcast_guid) {
    db.prepare('UPDATE podcasts SET guid = ? WHERE id = ?').run(feed.podcast_guid, podcastId)
  }

  // Backfill channel metadata from the source — but only into fields the
  // user hasn't already filled in. Anything they typed before importing
  // wins. Defaults like 'episodic' / 'no' / 'Society & Culture' don't
  // count as "filled" — we want the source values to override the seed
  // defaults but leave intentional edits alone.
  const SCHEMA_DEFAULTS: Record<string, string> = {
    itunes_type: 'episodic',
    podcast_locked: 'no',
    category: 'Society & Culture',
    language: 'en',
    explicit: 'false',
  }
  const backfillable = [
    'description', 'author', 'image_url', 'language',
    'copyright', 'category', 'explicit', 'itunes_type', 'podcast_locked',
    'verify_txt', 'license_identifier', 'license_url',
  ] as const
  const sourceValues: Record<string, string | null> = {
    description: feed.description,
    author: feed.author,
    image_url: feed.image_url,
    language: feed.language,
    copyright: feed.copyright,
    category: feed.category,
    explicit: feed.explicit,
    itunes_type: feed.itunes_type,
    podcast_locked: feed.podcast_locked,
    verify_txt: feed.verify_txt,
    license_identifier: feed.license_identifier,
    license_url: feed.license_url,
  }
  const current = db.prepare(`
    SELECT description, author, image_url, language, copyright, category,
           explicit, itunes_type, podcast_locked, verify_txt,
           license_identifier, license_url
    FROM podcasts WHERE id = ?
  `).get(podcastId) as Record<string, string | null>

  const setClauses: string[] = []
  const setValues: Record<string, unknown> = { id: podcastId }
  for (const field of backfillable) {
    const sourceVal = sourceValues[field]
    const currentVal = current[field]
    const isEmpty = currentVal === null || currentVal === '' || currentVal === SCHEMA_DEFAULTS[field as string]
    if (sourceVal && isEmpty) {
      setClauses.push(`${field} = @${field}`)
      setValues[field] = sourceVal
    }
  }
  if (setClauses.length > 0) {
    db.prepare(`UPDATE podcasts SET ${setClauses.join(', ')}, updated_at = datetime('now') WHERE id = @id`).run(setValues)
  }

  if (imported > 0 || setClauses.length > 0 || feed.podcast_guid) {
    bumpFeedLastModified(podcastId)
  }
  if (imported > 0) {
    maybeAutoTrigger(podcastId, 'rss-import')
  }

  const warnings: string[] = []
  if (unnumbered > 0) {
    warnings.push(
      `${unnumbered} episode${unnumbered === 1 ? '' : 's'} imported without an episode number. `
      + 'Source feed had no <itunes:episode> tag and the title didn\'t match a recognized pattern '
      + '(#N, "Episode N", "Ep N"). Review titles to backfill.'
    )
  }
  const httpImageTotal = httpImages + (channelImageIsHttp ? 1 : 0)
  if (httpImageTotal > 0) {
    warnings.push(
      `${httpImageTotal} image URL${httpImageTotal === 1 ? '' : 's'} use http://. `
      + 'Modern podcast clients and feed validators flag mixed-content; consider switching to https:// where the host supports it.'
    )
  }

  logAudit(event, {
    podcastId,
    userId: user.id,
    action: 'podcast.import-rss',
    entityType: 'podcast',
    entityId: podcastId,
    summary: `Imported ${imported} episode${imported === 1 ? '' : 's'} from ${feedUrl} (${skipped} skipped)`,
    details: {
      feed_url: feedUrl,
      feed_title: feed.title,
      imported,
      skipped,
      unnumbered,
      settings_backfilled: setClauses.map((c) => c.split(' = ')[0]),
    },
  })

  return {
    feed_title: feed.title,
    total_items: feed.items.length,
    imported,
    skipped,
    unnumbered,
    warnings,
    settings_backfilled: setClauses.map((c) => c.split(' = ')[0]),
  }
})
