import { defineEventHandler, setHeader, getHeader, setResponseStatus, createError } from 'h3'
import getDb from '../../db/index'
import { computePodcastGuid } from '../../utils/podcast-guid'
import { processScheduledFlips } from '../../utils/scheduler'

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
  guid: string | null
  itunes_type: string | null
  podcast_locked: string | null
  itunes_complete: string | null
  itunes_block: string | null
  funding_url: string | null
  funding_label: string | null
  verify_txt: string | null
  license_identifier: string | null
  license_url: string | null
  feed_last_modified: string | null
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
  image_url: string | null
  published_at: string | null
  guid: string | null
  episode_type: string | null
  transcript_path: string | null
  transcript_type: string | null
  chapters_url: string | null
  itunes_title: string | null
  itunes_author: string | null
  itunes_explicit: string | null
  season_name: string | null
  episode_display: string | null
  license_identifier: string | null
  license_url: string | null
}

interface PersonRow {
  episode_id: number | null
  name: string
  role: string
  group: string
  img_url: string | null
  href: string | null
}

interface ChannelPersonRow {
  name: string
  role: string
  group: string
  img_url: string | null
  href: string | null
}

// Strip characters that are illegal in XML 1.0 even inside CDATA (C0 controls
// other than tab/LF/CR). A single one pasted into a title or description — or
// sent via the API, which doesn't validate text fields — makes the ENTIRE feed
// unparseable by Apple/Spotify, so one bad episode takes the whole feed down.
function stripInvalidXml(str: string): string {
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
}

function escapeXml(str: string): string {
  return stripInvalidXml(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function cdata(str: string): string {
  return `<![CDATA[${stripInvalidXml(str).replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`
}

// Best-effort MIME type from the audio URL's extension. Podcast clients use
// the enclosure `type` to decide playback; advertising audio/mpeg for an m4a
// (which the upload endpoint accepts) makes some clients refuse the file.
function mimeForAudio(url: string): string {
  const u = url.split(/[?#]/)[0].toLowerCase()
  if (u.endsWith('.m4a') || u.endsWith('.mp4') || u.endsWith('.m4b')) return 'audio/mp4'
  if (u.endsWith('.aac')) return 'audio/aac'
  if (u.endsWith('.opus')) return 'audio/opus'
  if (u.endsWith('.ogg') || u.endsWith('.oga')) return 'audio/ogg'
  if (u.endsWith('.wav')) return 'audio/wav'
  if (u.endsWith('.flac')) return 'audio/flac'
  return 'audio/mpeg'
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

function guessTranscriptType(url: string): string {
  const u = url.toLowerCase()
  if (u.endsWith('.srt')) return 'application/srt'
  if (u.endsWith('.vtt')) return 'text/vtt'
  if (u.endsWith('.json')) return 'application/json'
  if (u.endsWith('.txt')) return 'text/plain'
  return 'text/html'
}

function renderPerson(p: { name: string; role: string; group: string; img_url: string | null; href: string | null }, indent: string): string {
  const attrs: string[] = [`role="${escapeXml(p.role)}"`, `group="${escapeXml(p.group)}"`]
  if (p.img_url) attrs.push(`img="${escapeXml(p.img_url)}"`)
  if (p.href) attrs.push(`href="${escapeXml(p.href)}"`)
  return `${indent}<podcast:person ${attrs.join(' ')}>${cdata(p.name)}</podcast:person>`
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

  let podcast = db.prepare(`
    SELECT id, slug, title, description, author, email, image_url, language,
           copyright, category, explicit, website, audio_tracking_prefix, guid,
           itunes_type, podcast_locked, itunes_complete, itunes_block,
           funding_url, funding_label, verify_txt, license_identifier, license_url,
           feed_last_modified
    FROM podcasts WHERE slug = ? AND status = 'active'
  `).get(slug) as Podcast | undefined

  // Slug-alias fallback: if the requested slug doesn't match an active
  // podcast, check whether it's a previous slug. When it is, serve the same
  // feed but with `<itunes:new-feed-url>` so modern apps auto-migrate
  // subscribers to the canonical URL.
  let viaAlias = false
  if (!podcast) {
    const alias = db.prepare(`
      SELECT p.id, p.slug, p.title, p.description, p.author, p.email, p.image_url, p.language,
             p.copyright, p.category, p.explicit, p.website, p.audio_tracking_prefix, p.guid,
             p.itunes_type, p.podcast_locked, p.itunes_complete, p.itunes_block,
             p.funding_url, p.funding_label, p.verify_txt, p.license_identifier, p.license_url,
             p.feed_last_modified
      FROM slug_aliases a
      JOIN podcasts p ON p.id = a.podcast_id
      WHERE a.old_slug = ? AND p.status = 'active'
    `).get(slug) as Podcast | undefined
    if (alias) {
      podcast = alias
      viaAlias = true
    }
  }

  if (!podcast) {
    throw createError({ statusCode: 404, statusMessage: 'Podcast not found' })
  }

  // Lazy flip: if the in-process scheduler is dead (or the server just
  // started and a scheduled time has already passed), make sure overdue
  // episodes are flipped before we render the feed. Cheap when nothing's
  // overdue (single indexed SELECT). The webhook/GitHub side effects are
  // fire-and-forget inside processScheduledFlips so this doesn't block.
  processScheduledFlips(podcast.id)

  // Conditional GET: most podcast app polls return identical XML, so honor
  // If-Modified-Since with a 304 to save bandwidth. Compare at second
  // precision since HTTP-date doesn't carry sub-second.
  const lastModifiedDate = new Date(podcast.feed_last_modified || Date.now())
  setHeader(event, 'Last-Modified', lastModifiedDate.toUTCString())
  const ifModifiedSince = getHeader(event, 'if-modified-since')
  if (ifModifiedSince) {
    const since = new Date(ifModifiedSince)
    if (!isNaN(since.getTime()) &&
        Math.floor(lastModifiedDate.getTime() / 1000) <= Math.floor(since.getTime() / 1000)) {
      setResponseStatus(event, 304)
      return null
    }
  }

  const siteUrl = (process.env.SITE_URL || (useRuntimeConfig().public.siteUrl as string) || '').replace(/\/+$/, '')
  // selfFeedUrl always points at the canonical (current) slug — even when
  // we're serving the response under an alias slug, we want subscribers'
  // apps to follow the new-feed-url and update their stored subscription.
  const selfFeedUrl = `${siteUrl}/feeds/${podcast.slug}.xml`

  // Lazily assign a stable Podcasting 2.0 channel GUID on first feed render.
  // Derived from the feed URL per spec, then persisted so it survives any
  // future URL change.
  let podcastGuid = podcast.guid
  if (!podcastGuid) {
    podcastGuid = computePodcastGuid(selfFeedUrl)
    db.prepare('UPDATE podcasts SET guid = ? WHERE id = ?').run(podcastGuid, podcast.id)
  }

  const episodes = db.prepare(`
    SELECT id, title, slug, episode_number, season_number,
           description, audio_url, audio_size_bytes,
           audio_duration_seconds, image_url, published_at, guid, episode_type,
           transcript_path, transcript_type, chapters_url,
           itunes_title, itunes_author, itunes_explicit,
           season_name, episode_display,
           license_identifier, license_url
    FROM episodes
    WHERE podcast_id = ? AND status = 'published' AND published_at IS NOT NULL
    ORDER BY published_at DESC
  `).all(podcast.id) as Episode[]

  // Channel-level <podcast:person> = the show's regular cast (auto_attach=1)
  // using each person's *current* default_role/default_group. Per-episode
  // <podcast:person> uses the role/group frozen at attach time.
  const channelPeople = db.prepare(`
    SELECT name, default_role AS role, default_group AS "group", img_url, href
    FROM people
    WHERE podcast_id = ? AND auto_attach = 1
    ORDER BY id
  `).all(podcast.id) as ChannelPersonRow[]

  let episodePeopleByEpId = new Map<number, PersonRow[]>()
  if (episodes.length > 0) {
    const placeholders = episodes.map(() => '?').join(',')
    const rows = db.prepare(`
      SELECT ep.episode_id, p.name, ep.role, ep."group", p.img_url, p.href
      FROM episode_people ep
      JOIN people p ON p.id = ep.person_id
      WHERE ep.episode_id IN (${placeholders})
      ORDER BY ep.episode_id, ep.position, ep.id
    `).all(...episodes.map((e) => e.id)) as PersonRow[]
    for (const r of rows) {
      if (r.episode_id == null) continue
      if (!episodePeopleByEpId.has(r.episode_id)) episodePeopleByEpId.set(r.episode_id, [])
      episodePeopleByEpId.get(r.episode_id)!.push(r)
    }
  }

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
  const itunesType = podcast.itunes_type === 'serial' ? 'serial' : 'episodic'
  const podcastLocked = podcast.podcast_locked === 'yes' ? 'yes' : 'no'
  const itunesComplete = podcast.itunes_complete === 'yes'
  const itunesBlock = podcast.itunes_block === 'yes'
  const fundingUrl = (podcast.funding_url || '').trim()
  const fundingLabel = (podcast.funding_label || '').trim() || 'Support the show'
  const verifyTxt = (podcast.verify_txt || '').trim()
  const channelLicenseId = (podcast.license_identifier || '').trim()
  const channelLicenseUrl = (podcast.license_url || '').trim()
  const lastBuildDate = new Date().toUTCString()

  // Lazily lock in a stable per-episode GUID. Using the episode URL keeps
  // backwards compatibility with what we previously emitted, so existing
  // subscribers don't see every episode as "new". Once persisted, future
  // slug or website changes won't churn the GUID.
  const episodesNeedingGuid = episodes.filter((ep) => !ep.guid)
  if (episodesNeedingGuid.length > 0) {
    const updateGuid = db.prepare(`UPDATE episodes SET guid = ?, updated_at = datetime('now') WHERE id = ?`)
    db.transaction(() => {
      for (const ep of episodesNeedingGuid) {
        const epUrl = websiteBase ? `${websiteBase}/episodes/${ep.slug}` : `/episodes/${ep.slug}`
        ep.guid = epUrl
        updateGuid.run(epUrl, ep.id)
      }
    })()
  }

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
      xml += `      <enclosure url="${escapeXml(feedAudioUrl)}" length="${audioSize}" type="${mimeForAudio(audioUrl)}"/>\n`
    }

    xml += `      <guid isPermaLink="false">${escapeXml(ep.guid || episodeUrl)}</guid>\n`
    xml += `      <itunes:summary>${cdata(description)}</itunes:summary>\n`

    if (ep.audio_duration_seconds) {
      xml += `      <itunes:duration>${formatDuration(ep.audio_duration_seconds)}</itunes:duration>\n`
    }

    if (ep.itunes_title && ep.itunes_title.trim()) {
      xml += `      <itunes:title>${cdata(ep.itunes_title.trim())}</itunes:title>\n`
    }
    if (ep.itunes_author && ep.itunes_author.trim()) {
      xml += `      <itunes:author>${cdata(ep.itunes_author.trim())}</itunes:author>\n`
    }
    if (ep.itunes_explicit === 'true' || ep.itunes_explicit === 'false') {
      xml += `      <itunes:explicit>${ep.itunes_explicit}</itunes:explicit>\n`
    }

    if (ep.episode_number !== null && ep.episode_number !== undefined && ep.episode_type !== 'bonus') {
      xml += `      <itunes:episode>${ep.episode_number}</itunes:episode>\n`
      // Podcasting 2.0 sibling. `display` is optional.
      const displayAttr = ep.episode_display && ep.episode_display.trim()
        ? ` display="${escapeXml(ep.episode_display.trim())}"`
        : ''
      xml += `      <podcast:episode${displayAttr}>${ep.episode_number}</podcast:episode>\n`
    }

    if (ep.season_number !== null && ep.season_number !== undefined) {
      xml += `      <itunes:season>${ep.season_number}</itunes:season>\n`
      const nameAttr = ep.season_name && ep.season_name.trim()
        ? ` name="${escapeXml(ep.season_name.trim())}"`
        : ''
      xml += `      <podcast:season${nameAttr}>${ep.season_number}</podcast:season>\n`
    }

    const epType = ep.episode_type === 'trailer' || ep.episode_type === 'bonus' ? ep.episode_type : 'full'
    xml += `      <itunes:episodeType>${epType}</itunes:episodeType>\n`

    if (ep.image_url) {
      xml += `      <itunes:image href="${escapeXml(ep.image_url)}"/>\n`
    }

    const transcriptUrl = (ep.transcript_path || '').trim()
    if (transcriptUrl) {
      const transcriptType = (ep.transcript_type || '').trim() || guessTranscriptType(transcriptUrl)
      xml += `      <podcast:transcript url="${escapeXml(transcriptUrl)}" type="${escapeXml(transcriptType)}"/>\n`
    }

    if (ep.chapters_url && ep.chapters_url.trim()) {
      xml += `      <podcast:chapters url="${escapeXml(ep.chapters_url.trim())}" type="application/json+chapters"/>\n`
    }

    // Per-episode license overrides the channel-level license for this episode.
    const epLicenseId = (ep.license_identifier || '').trim()
    const epLicenseUrl = (ep.license_url || '').trim()
    if (epLicenseId || epLicenseUrl) {
      const urlAttr = epLicenseUrl ? ` url="${escapeXml(epLicenseUrl)}"` : ''
      xml += `      <podcast:license${urlAttr}>${cdata(epLicenseId || 'custom')}</podcast:license>\n`
    }

    const people = episodePeopleByEpId.get(ep.id) || []
    for (const p of people) {
      xml += renderPerson(p, '      ') + '\n'
    }

    xml += `    </item>`
    return xml
  }).join('\n')

  const channelLink = websiteBase || ''
  const channelPeopleXml = channelPeople.length > 0
    ? channelPeople.map((p) => renderPerson(p, '    ')).join('\n') + '\n'
    : ''

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>${cdata(showTitle)}</title>
    <link>${escapeXml(channelLink)}</link>
    <atom:link href="${escapeXml(selfFeedUrl)}" rel="self" type="application/rss+xml"/>
    <description>${cdata(showDescription)}</description>
    <language>${escapeXml(showLanguage)}</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <generator>Podshelf</generator>
    ${viaAlias ? `<itunes:new-feed-url>${escapeXml(selfFeedUrl)}</itunes:new-feed-url>` : ''}
    <podcast:guid>${escapeXml(podcastGuid)}</podcast:guid>
    <podcast:medium>podcast</podcast:medium>
    <podcast:locked>${podcastLocked}</podcast:locked>
    ${fundingUrl ? `<podcast:funding url="${escapeXml(fundingUrl)}">${cdata(fundingLabel)}</podcast:funding>` : ''}
    ${verifyTxt ? `<podcast:txt purpose="verify">${cdata(verifyTxt)}</podcast:txt>` : ''}
    ${(channelLicenseId || channelLicenseUrl) ? `<podcast:license${channelLicenseUrl ? ` url="${escapeXml(channelLicenseUrl)}"` : ''}>${cdata(channelLicenseId || 'custom')}</podcast:license>` : ''}
    ${showCopyright ? `<copyright>${cdata(showCopyright)}</copyright>` : ''}
    <itunes:author>${cdata(showAuthor)}</itunes:author>
    <itunes:type>${itunesType}</itunes:type>
    ${itunesComplete ? '<itunes:complete>yes</itunes:complete>' : ''}
    ${itunesBlock ? '<itunes:block>yes</itunes:block>' : ''}
    <itunes:owner>
      <itunes:name>${cdata(showAuthor)}</itunes:name>
      <itunes:email>${escapeXml(showEmail)}</itunes:email>
    </itunes:owner>
    ${showImageUrl ? `<itunes:image href="${escapeXml(showImageUrl)}"/>` : ''}
    <itunes:category text="${escapeXml(showCategory)}"/>
    <itunes:explicit>${escapeXml(showExplicit)}</itunes:explicit>
${channelPeopleXml}    <image>
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
