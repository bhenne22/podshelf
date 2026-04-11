/**
 * Seed the Podshelf database from the YS100M RSS feed.
 *
 * Usage:
 *   npx tsx scripts/seed-from-rss.ts
 *
 * Fetches the live RSS feed, parses it, and populates the settings
 * and episodes tables. Skips episodes that already exist (by slug).
 * All episodes are inserted with status "published".
 */

import Database from 'better-sqlite3'
import { readFileSync, mkdirSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { XMLParser } from 'fast-xml-parser'

// ---------------------------------------------------------------------------
// Database setup (mirrors server/db/index.ts)
// ---------------------------------------------------------------------------

function initDb(): Database.Database {
  const dbPath = process.env.DATABASE_PATH || './data/podshelf.db'
  const resolvedPath = resolve(dbPath)
  const dir = dirname(resolvedPath)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const db = new Database(resolvedPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  const schemaPath = resolve('./server/db/schema.sql')
  const schemaSql = readFileSync(schemaPath, 'utf-8')
  db.exec(schemaSql)

  return db
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Extract plain-text description from HTML. Strips tags and decodes
 * common entities. Good enough for seed data.
 */
function stripHtml(html: string | undefined): string {
  if (!html) return ''
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// RSS feed fetching and parsing
// ---------------------------------------------------------------------------

const RSS_URL = 'https://www.teampumaknife.com/feed/yousaid100miles/'

interface RssItem {
  title: string
  description?: string
  'content:encoded'?: string
  link?: string
  pubDate?: string
  enclosure?: {
    '@_url'?: string
    '@_length'?: string
    '@_type'?: string
  }
  'itunes:duration'?: string | number
  'itunes:episode'?: string | number
  'itunes:season'?: string | number
  'itunes:keywords'?: string
  category?: string | string[]
}

interface RssChannel {
  title?: string
  description?: string
  'itunes:author'?: string
  'itunes:image'?: { '@_href'?: string }
  image?: { url?: string }
  language?: string
  copyright?: string
  'itunes:category'?: { '@_text'?: string } | Array<{ '@_text'?: string }>
  link?: string
  'itunes:explicit'?: string | boolean
  item?: RssItem | RssItem[]
}

async function fetchAndParseRss(): Promise<RssChannel> {
  console.log(`Fetching RSS feed from ${RSS_URL} ...`)
  const response = await fetch(RSS_URL)
  if (!response.ok) {
    throw new Error(`Failed to fetch RSS feed: ${response.status} ${response.statusText}`)
  }
  const xml = await response.text()
  console.log(`Fetched ${xml.length} bytes of XML.`)

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => name === 'item',
  })
  const parsed = parser.parse(xml)
  const channel: RssChannel = parsed?.rss?.channel
  if (!channel) {
    throw new Error('Could not find <channel> in RSS feed')
  }
  return channel
}

// ---------------------------------------------------------------------------
// Parse duration string (HH:MM:SS or MM:SS or seconds) into seconds
// ---------------------------------------------------------------------------

function parseDuration(raw: string | number | undefined): number | null {
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw === 'number') return raw
  const parts = raw.split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  const n = Number(raw)
  return isNaN(n) ? null : n
}

// ---------------------------------------------------------------------------
// Build tags string from RSS item
// ---------------------------------------------------------------------------

function buildTags(item: RssItem): string | null {
  const keywords = item['itunes:keywords']
  if (keywords) return keywords
  const cat = item.category
  if (Array.isArray(cat)) return cat.join(', ')
  if (typeof cat === 'string') return cat
  return null
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const channel = await fetchAndParseRss()

  const db = initDb()
  console.log(`Database initialized at ${resolve(process.env.DATABASE_PATH || './data/podshelf.db')}`)

  // --- Seed settings -------------------------------------------------------

  const showCategory = (() => {
    const cat = channel['itunes:category']
    if (Array.isArray(cat)) return cat.map(c => c['@_text']).filter(Boolean).join(' - ')
    if (cat && cat['@_text']) return cat['@_text']
    return 'Society & Culture'
  })()

  const showImageUrl =
    channel['itunes:image']?.['@_href'] ||
    channel.image?.url ||
    ''

  const settings: Record<string, string> = {
    show_title: String(channel.title || 'My Podcast'),
    show_description: String(channel.description || ''),
    show_author: String(channel['itunes:author'] || ''),
    show_image_url: showImageUrl,
    show_language: String(channel.language || 'en'),
    show_copyright: String(channel.copyright || ''),
    show_category: showCategory,
    show_website: String(channel.link || ''),
    show_explicit: String(channel['itunes:explicit'] ?? 'false'),
  }

  const upsertSetting = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `)

  const settingsTransaction = db.transaction(() => {
    for (const [key, value] of Object.entries(settings)) {
      upsertSetting.run(key, value)
    }
  })
  settingsTransaction()
  console.log(`Upserted ${Object.keys(settings).length} settings.`)

  // --- Seed episodes -------------------------------------------------------

  const items = Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : []
  console.log(`Found ${items.length} episodes in feed.`)

  const insertEpisode = db.prepare(`
    INSERT OR IGNORE INTO episodes (
      title, slug, episode_number, season_number,
      description, audio_url, audio_filename, audio_size_bytes,
      audio_duration_seconds, published_at, status, tags, created_at, updated_at
    ) VALUES (
      @title, @slug, @episode_number, @season_number,
      @description, @audio_url, @audio_filename, @audio_size_bytes,
      @audio_duration_seconds, @published_at, @status, @tags, datetime('now'), datetime('now')
    )
  `)

  let inserted = 0
  let skipped = 0

  const episodesTransaction = db.transaction(() => {
    for (const item of items) {
      const title = String(item.title || 'Untitled')
      const slug = slugify(title)
      const audioUrl = item.enclosure?.['@_url'] || ''
      const audioFilename = audioUrl ? audioUrl.split('/').pop() || '' : ''
      const audioSize = item.enclosure?.['@_length'] ? Number(item.enclosure['@_length']) : null
      const duration = parseDuration(item['itunes:duration'])
      const publishedAt = item.pubDate ? new Date(item.pubDate).toISOString() : null
      const description = item['content:encoded'] || item.description || ''
      const episodeNumber = item['itunes:episode'] ? Number(item['itunes:episode']) : null
      const seasonNumber = item['itunes:season'] ? Number(item['itunes:season']) : null
      const tags = buildTags(item)

      const result = insertEpisode.run({
        title,
        slug,
        episode_number: episodeNumber,
        season_number: seasonNumber,
        description,
        audio_url: audioUrl,
        audio_filename: audioFilename,
        audio_size_bytes: audioSize,
        audio_duration_seconds: duration,
        published_at: publishedAt,
        status: 'published',
        tags,
      })

      if (result.changes > 0) {
        inserted++
      } else {
        skipped++
      }
    }
  })
  episodesTransaction()

  // --- Summary -------------------------------------------------------------

  console.log('')
  console.log('--- Seed Summary ---')
  console.log(`Settings: ${Object.keys(settings).length} upserted`)
  console.log(`Episodes: ${inserted} inserted, ${skipped} skipped (already existed)`)

  const totalEpisodes = db.prepare('SELECT COUNT(*) as count FROM episodes').get() as { count: number }
  console.log(`Total episodes in database: ${totalEpisodes.count}`)

  db.close()
  console.log('Done.')
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
