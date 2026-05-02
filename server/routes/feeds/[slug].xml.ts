import { defineEventHandler, setHeader, createError } from 'h3'
import getDb from '../../db/index'

interface Podcast {
  id: number
  slug: string
  title: string
  description: string | null
  author: string | null
  email: string | null
  image_url: string | null
  language: string | null
  copyright: string | null
  category: string | null
  explicit: string | null
  website: string | null
  audio_tracking_prefix: string | null
}

interface Episode {
  id: number
  title: string
  slug: string
  episode_number: number | null
  season_number: number | null
  description: string | null
  audio_url: string | null
  audio_size_bytes: number | null
  audio_duration_seconds: number | null
  published_at: string | null
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
  return `<![CDATA[${str.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

function toRfc2822(isoString: string): string {
  return new Date(isoString).toUTCString()
}

export default defineEventHandler((event) => {
  // Nitro's `[slug].xml` route binding doesn't reliably populate the slug
  // param (the literal .xml in the route eats the binding), so parse the
  // path ourselves. The file naming still scopes this handler to *.xml URLs.
  const m = (event.path || '').match(/^\/feeds\/([^/]+)\.xml(?:\?|$)/)
  const slug = m?.[1]
  if (!slug) {
    throw createError({ statusCode: 404, statusMessage: 'Bad feed URL' })
  }
  const db = getDb()

  const podcast = db.prepare(`
    SELECT id, slug, title, description, author, email, image_url, language,
           copyright, category, explicit, website, audio_tracking_prefix
    FROM podcasts WHERE slug = ?
  `).get(slug) as Podcast | undefined

  if (!podcast) {
    throw createError({ statusCode: 404, statusMessage: 'Podcast not found' })
  }

  const episodes = db.prepare(`
    SELECT id, title, slug, episode_number, season_number,
           description, audio_url, audio_size_bytes,
           audio_duration_seconds, published_at
    FROM episodes
    WHERE podcast_id = ? AND status = 'published' AND published_at IS NOT NULL
    ORDER BY published_at DESC
  `).all(podcast.id) as Episode[]

  const showTitle = podcast.title || 'Untitled Podcast'
  const showDescription = podcast.description || ''
  const showAuthor = podcast.author || ''
  const showEmail = podcast.email || ''
  const showImageUrl = podcast.image_url || ''
  const showLanguage = podcast.language || 'en'
  const showCopyright = podcast.copyright || ''
  const showCategory = podcast.category || 'Society & Culture'
  const showExplicit = podcast.explicit || 'false'
  const websiteBase = (podcast.website || '').replace(/\/+$/, '')
  const audioTrackingPrefix = podcast.audio_tracking_prefix || ''

  const itemsXml = episodes.map((ep) => {
    const episodeUrl = websiteBase ? `${websiteBase}/episodes/${ep.slug}` : `/episodes/${ep.slug}`
    const audioUrl = ep.audio_url || ''
    const audioSize = ep.audio_size_bytes || 0
    const pubDate = ep.published_at ? toRfc2822(ep.published_at) : ''
    const description = ep.description || ''

    let xml = `    <item>\n`
    xml += `      <title>${cdata(ep.title)}</title>\n`
    xml += `      <link>${escapeXml(episodeUrl)}</link>\n`
    xml += `      <description>${cdata(description)}</description>\n`
    xml += `      <content:encoded>${cdata(description)}</content:encoded>\n`

    if (pubDate) xml += `      <pubDate>${pubDate}</pubDate>\n`

    if (audioUrl) {
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

  const channelLink = websiteBase || ''

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${cdata(showTitle)}</title>
    <link>${escapeXml(channelLink)}</link>
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
      <link>${escapeXml(channelLink)}</link>
    </image>
${itemsXml}
  </channel>
</rss>`

  setHeader(event, 'Content-Type', 'application/rss+xml; charset=utf-8')
  return rss
})
