import { defineEventHandler, setHeader } from 'h3'
import getDb from '../db/index'

interface Episode {
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
  published_at: string | null
  status: string
  tags: string | null
  created_at: string
}

interface Settings {
  [key: string]: string
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function cdata(str: string): string {
  // Close any existing ]]> sequences to avoid breaking CDATA
  return `<![CDATA[${str.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`
}

/**
 * Format seconds as HH:MM:SS for iTunes duration
 */
function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Convert ISO datetime string to RFC 2822 format for RSS pubDate.
 */
function toRfc2822(isoString: string): string {
  const date = new Date(isoString)
  return date.toUTCString()
}

export default defineEventHandler((event) => {
  const db = getDb()

  const siteUrl = process.env.SITE_URL || 'http://localhost:3000'

  // Fetch settings
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
  const settings: Settings = {}
  for (const row of rows) {
    settings[row.key] = row.value
  }

  const showTitle = settings.show_title || 'My Podcast'
  const showDescription = settings.show_description || ''
  const showAuthor = settings.show_author || ''
  const showEmail = settings.show_email || ''
  const showImageUrl = settings.show_image_url || ''
  const showLanguage = settings.show_language || 'en'
  const showCopyright = settings.show_copyright || ''
  const showCategory = settings.show_category || 'Society & Culture'
  const showExplicit = settings.show_explicit || 'false'
  const showWebsite = settings.show_website || siteUrl
  const audioTrackingPrefix = settings.audio_tracking_prefix || ''

  // Fetch published episodes ordered by published_at DESC
  const episodes = db.prepare(`
    SELECT
      id, title, slug, episode_number, season_number,
      description, audio_url, audio_filename, audio_size_bytes,
      audio_duration_seconds, published_at, status, tags, created_at
    FROM episodes
    WHERE status = 'published' AND published_at IS NOT NULL
    ORDER BY published_at DESC
  `).all() as Episode[]

  const itemsXml = episodes.map((ep) => {
    const episodeUrl = `${siteUrl}/episodes/${ep.slug}`
    const audioUrl = ep.audio_url || ''
    const audioSize = ep.audio_size_bytes || 0
    const pubDate = ep.published_at ? toRfc2822(ep.published_at) : ''
    const description = ep.description || ''

    let xml = `    <item>\n`
    xml += `      <title>${cdata(ep.title)}</title>\n`
    xml += `      <link>${escapeXml(episodeUrl)}</link>\n`
    xml += `      <description>${cdata(description)}</description>\n`
    xml += `      <content:encoded>${cdata(description)}</content:encoded>\n`

    if (pubDate) {
      xml += `      <pubDate>${pubDate}</pubDate>\n`
    }

    if (audioUrl) {
      // When a tracking prefix is set (e.g. https://media.blubrry.com/1467354/),
      // strip the protocol from the audio URL since the prefix provides the scheme
      const feedAudioUrl = audioTrackingPrefix
        ? audioTrackingPrefix + audioUrl.replace(/^https?:\/\//, '')
        : audioUrl
      xml += `      <enclosure url="${escapeXml(feedAudioUrl)}" length="${audioSize}" type="audio/mpeg"/>\n`
    }

    xml += `      <guid isPermaLink="false">${escapeXml(episodeUrl)}</guid>\n`
    xml += `      <itunes:summary>${cdata(description)}</itunes:summary>\n`

    if (ep.audio_duration_seconds) {
      xml += `      <itunes:duration>${formatDuration(ep.audio_duration_seconds)}</itunes:duration>\n`
    }

    if (ep.episode_number !== null && ep.episode_number !== undefined) {
      xml += `      <itunes:episode>${ep.episode_number}</itunes:episode>\n`
    }

    if (ep.season_number !== null && ep.season_number !== undefined) {
      xml += `      <itunes:season>${ep.season_number}</itunes:season>\n`
    }

    xml += `    </item>`
    return xml
  }).join('\n')

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${cdata(showTitle)}</title>
    <link>${escapeXml(showWebsite)}</link>
    <description>${cdata(showDescription)}</description>
    <language>${escapeXml(showLanguage)}</language>
    ${showCopyright ? `<copyright>${cdata(showCopyright)}</copyright>` : ''}
    <itunes:author>${cdata(showAuthor)}</itunes:author>
    <itunes:owner>
      <itunes:name>${cdata(showAuthor)}</itunes:name>
      <itunes:email>${escapeXml(showEmail)}</itunes:email>
    </itunes:owner>
    ${showImageUrl ? `<itunes:image href="${escapeXml(showImageUrl)}"/>` : ''}
    <itunes:category text="${escapeXml(showCategory)}"/>
    <itunes:explicit>${escapeXml(showExplicit)}</itunes:explicit>
    <image>
      ${showImageUrl ? `<url>${escapeXml(showImageUrl)}</url>` : ''}
      <title>${cdata(showTitle)}</title>
      <link>${escapeXml(showWebsite)}</link>
    </image>
${itemsXml}
  </channel>
</rss>`

  setHeader(event, 'Content-Type', 'application/rss+xml; charset=utf-8')
  return rss
})
