import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../utils/auth'
import { parsePodcastFeed } from '../../../utils/rss-parser'
import { maybeAutoTrigger } from '../../../utils/github'
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
      published_at, status, tags
    ) VALUES (
      @podcast_id, @title, @slug, @episode_number, @season_number,
      @description, @audio_url, @audio_size_bytes, @audio_duration_seconds,
      @published_at, 'published', NULL
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
      })
      imported++
    }
    return { imported, skipped }
  })

  const { imported, skipped } = tx(feed.items)

  if (imported > 0) {
    maybeAutoTrigger(podcastId, 'rss-import')
  }

  return {
    feed_title: feed.title,
    total_items: feed.items.length,
    imported,
    skipped,
  }
})
