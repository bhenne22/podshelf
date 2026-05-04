import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../utils/auth'
import { parsePodcastFeed } from '../../../utils/rss-parser'
import { maybeAutoTrigger } from '../../../utils/github'
import { bumpFeedLastModified } from '../../../utils/feed-cache'
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
  const { podcastId } = requirePodcastAccess(event, slug)

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
      published_at, status, tags, guid, episode_type
    ) VALUES (
      @podcast_id, @title, @slug, @episode_number, @season_number,
      @description, @audio_url, @audio_size_bytes, @audio_duration_seconds,
      @published_at, 'published', NULL, @guid, @episode_type
    )
  `)

  const tx = db.transaction((items: typeof feed.items) => {
    let imported = 0
    let skipped = 0
    for (const item of items) {
      if (!item.audio_url) {
        skipped++
        continue
      }
      const slug = uniqueSlug(slugify(item.title))
      insert.run({
        podcast_id: podcastId,
        title: item.title,
        slug,
        episode_number: item.episode_number,
        season_number: item.season_number,
        description: item.description,
        audio_url: item.audio_url,
        audio_size_bytes: item.audio_size_bytes,
        audio_duration_seconds: item.audio_duration_seconds,
        published_at: item.pubDate,
        guid: item.guid,
        episode_type: item.episode_type || 'full',
      })
      imported++
    }
    return { imported, skipped }
  })

  const { imported, skipped } = tx(feed.items)

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
  const backfillable: Array<keyof typeof SCHEMA_DEFAULTS | 'description' | 'author' | 'image_url' | 'copyright'> = [
    'description', 'author', 'image_url', 'language',
    'copyright', 'category', 'explicit', 'itunes_type', 'podcast_locked',
  ]
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
  }
  const current = db.prepare(`
    SELECT description, author, image_url, language, copyright, category,
           explicit, itunes_type, podcast_locked
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

  return {
    feed_title: feed.title,
    total_items: feed.items.length,
    imported,
    skipped,
    settings_backfilled: setClauses.map((c) => c.split(' = ')[0]),
  }
})
