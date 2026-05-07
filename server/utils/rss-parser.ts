import { XMLParser } from 'fast-xml-parser'
import { decodeEntities, inferEpisodeNumberFromTitle } from './text'

export interface ParsedItemPerson {
  name: string
  role: string
  group: string
  img: string | null
  href: string | null
}

export interface ParsedItem {
  title: string
  description: string | null
  pubDate: string | null
  audio_url: string | null
  audio_size_bytes: number | null
  audio_duration_seconds: number | null
  episode_number: number | null
  season_number: number | null
  guid: string | null
  episode_type: string | null
  transcript_url: string | null
  transcript_type: string | null
  chapters_url: string | null
  itunes_title: string | null
  itunes_author: string | null
  itunes_explicit: string | null
  season_name: string | null
  episode_display: string | null
  license_identifier: string | null
  license_url: string | null
  people: ParsedItemPerson[]
}

export interface ParsedChannelPerson {
  name: string
  role: string
  group: string
  img: string | null
  href: string | null
}

export interface ParsedFeed {
  title: string | null
  description: string | null
  language: string | null
  copyright: string | null
  author: string | null
  image_url: string | null
  category: string | null
  explicit: string | null
  itunes_type: string | null
  podcast_locked: string | null
  podcast_guid: string | null
  verify_txt: string | null
  license_identifier: string | null
  license_url: string | null
  people: ParsedChannelPerson[]
  items: ParsedItem[]
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  cdataPropName: '__cdata',
  trimValues: true,
})

/**
 * Coerce fast-xml-parser's loose value into a string.
 * It can return strings, numbers, objects (with __cdata), or arrays.
 */
function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    for (const v of value) {
      const s = asString(v)
      if (s) return s
    }
    return null
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if ('__cdata' in obj) return asString(obj.__cdata)
    if ('#text' in obj) return asString(obj['#text'])
  }
  return null
}

function asNumber(value: unknown): number | null {
  const s = asString(value)
  if (!s) return null
  const n = parseInt(s, 10)
  return Number.isFinite(n) ? n : null
}

/**
 * Parse iTunes-style duration. Accepts:
 *   - "HH:MM:SS"
 *   - "MM:SS"
 *   - "1234" (seconds)
 */
function parseDuration(value: unknown): number | null {
  const s = asString(value)
  if (!s) return null
  if (!s.includes(':')) {
    const n = parseInt(s, 10)
    return Number.isFinite(n) ? n : null
  }
  const parts = s.split(':').map((p) => parseInt(p, 10))
  if (parts.some((p) => !Number.isFinite(p))) return null
  let seconds = 0
  for (const p of parts) seconds = seconds * 60 + p
  return seconds
}

/**
 * Convert RFC 2822 date string to ISO 8601. Returns null if unparseable.
 */
function parsePubDate(value: unknown): string | null {
  const s = asString(value)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function asArray(value: unknown): unknown[] {
  if (value === null || value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function parsePeople(node: unknown): ParsedItemPerson[] {
  return asArray(node).map((raw) => {
    if (!raw || typeof raw !== 'object') return null
    const r = raw as Record<string, unknown>
    const name = asString(r['#text']) || asString(r.__cdata) || ''
    if (!name.trim()) return null
    return {
      name: name.trim(),
      role: (asString(r['@_role']) || 'host').trim(),
      group: (asString(r['@_group']) || 'cast').trim(),
      img: asString(r['@_img']),
      href: asString(r['@_href']),
    } as ParsedItemPerson
  }).filter((x): x is ParsedItemPerson => x !== null)
}

function parseLicense(node: unknown): { identifier: string | null; url: string | null } {
  if (!node || typeof node !== 'object') return { identifier: asString(node), url: null }
  const r = (Array.isArray(node) ? node[0] : node) as Record<string, unknown>
  const identifier = asString(r['#text']) || asString(r.__cdata) || asString(r)
  return { identifier: identifier?.trim() || null, url: asString(r['@_url']) }
}

function parseTxtVerify(node: unknown): string | null {
  for (const raw of asArray(node)) {
    if (!raw || typeof raw !== 'object') {
      const s = asString(raw)
      if (s) return s.trim()
      continue
    }
    const r = raw as Record<string, unknown>
    const purpose = (asString(r['@_purpose']) || '').toLowerCase()
    if (purpose === 'verify') {
      const text = asString(r['#text']) || asString(r.__cdata)
      if (text) return text.trim()
    }
  }
  return null
}

export function parsePodcastFeed(xml: string): ParsedFeed {
  const doc = parser.parse(xml) as { rss?: { channel?: Record<string, unknown> } }
  const channel = doc?.rss?.channel
  if (!channel) {
    throw new Error('Feed does not contain <rss><channel>; not a valid RSS feed.')
  }

  const rawItems = Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : []

  const items: ParsedItem[] = []
  for (const raw of rawItems) {
    const item = raw as Record<string, unknown>

    const rawTitle = asString(item.title)
    if (!rawTitle) continue
    // Decode entities — WordPress emits CDATA-wrapped titles with numeric
    // character refs like &#8211;, &#8217; that XML parsers preserve as-is.
    // The slug derives from this same decoded text downstream.
    const title = decodeEntities(rawTitle)

    const enclosure = item.enclosure as { '@_url'?: string; '@_length'?: string } | undefined
    const audio_url = enclosure?.['@_url'] || null
    const audio_size_bytes = enclosure?.['@_length'] ? parseInt(enclosure['@_length'], 10) : null

    const epType = (asString(item['itunes:episodeType']) || '').toLowerCase()

    const transcriptNode = item['podcast:transcript'] as { '@_url'?: string; '@_type'?: string } | { '@_url'?: string; '@_type'?: string }[] | undefined
    const firstTranscript = Array.isArray(transcriptNode) ? transcriptNode[0] : transcriptNode

    const chaptersNode = item['podcast:chapters'] as { '@_url'?: string } | undefined

    const epExplicitRaw = (asString(item['itunes:explicit']) || '').trim().toLowerCase()
    const epExplicit = ['yes', 'true', '1'].includes(epExplicitRaw)
      ? 'true'
      : ['no', 'false', '0', 'clean'].includes(epExplicitRaw)
        ? 'false'
        : null

    const seasonNode = item['podcast:season'] as { '@_name'?: string } | undefined
    const episodeNode = item['podcast:episode'] as { '@_display'?: string } | undefined

    const epLicense = parseLicense(item['podcast:license'])

    items.push({
      title,
      description: asString(item['content:encoded']) || asString(item.description),
      pubDate: parsePubDate(item.pubDate),
      audio_url,
      audio_size_bytes: Number.isFinite(audio_size_bytes) ? audio_size_bytes : null,
      audio_duration_seconds: parseDuration(item['itunes:duration']),
      // <itunes:episode> wins. Most WP-emitted feeds don't set it, so fall
      // back to the `#N` pattern in the title — strict regex, no false
      // positives on year-like digits.
      episode_number:
        asNumber(item['itunes:episode'])
        ?? asNumber(item['podcast:episode'])
        ?? inferEpisodeNumberFromTitle(title),
      season_number: asNumber(item['itunes:season']) ?? asNumber(item['podcast:season']),
      guid: asString(item.guid),
      episode_type: ['full', 'trailer', 'bonus'].includes(epType) ? epType : null,
      transcript_url: firstTranscript?.['@_url'] || null,
      transcript_type: firstTranscript?.['@_type'] || null,
      chapters_url: chaptersNode?.['@_url'] || null,
      itunes_title: decodeEntities(asString(item['itunes:title'])) || null,
      itunes_author: asString(item['itunes:author']),
      itunes_explicit: epExplicit,
      season_name: seasonNode?.['@_name'] || null,
      episode_display: episodeNode?.['@_display'] || null,
      license_identifier: epLicense.identifier,
      license_url: epLicense.url,
      people: parsePeople(item['podcast:person']),
    })
  }

  // <itunes:image href="..."/> — value is on the @_href attribute, not text.
  const imageNode = channel['itunes:image'] as { '@_href'?: string } | undefined
  const itunesImage = imageNode?.['@_href'] || asString((channel.image as { url?: unknown })?.url) || null

  // <itunes:category text="Sports"> may contain nested <itunes:category text="Running"/>.
  // Take the parent's text only — schema is single-category for now.
  const catNode = channel['itunes:category'] as { '@_text'?: string } | { '@_text'?: string }[] | undefined
  const firstCat = Array.isArray(catNode) ? catNode[0] : catNode
  const itunesCategory = firstCat?.['@_text'] || null

  // Normalize <podcast:locked> — spec says yes/no but publishers commonly use True/False.
  const lockedRaw = (asString(channel['podcast:locked']) || '').trim().toLowerCase()
  const podcastLocked = ['yes', 'true', '1'].includes(lockedRaw) ? 'yes' : lockedRaw ? 'no' : null

  // Normalize <itunes:explicit> — yes/no/true/false → 'true'/'false' to match our schema.
  const explicitRaw = (asString(channel['itunes:explicit']) || '').trim().toLowerCase()
  const explicit = ['yes', 'true', '1'].includes(explicitRaw)
    ? 'true'
    : ['no', 'false', '0', 'clean'].includes(explicitRaw)
      ? 'false'
      : null

  const itunesType = (asString(channel['itunes:type']) || '').toLowerCase()

  const channelLicense = parseLicense(channel['podcast:license'])

  return {
    title: asString(channel.title),
    description: asString(channel.description),
    language: asString(channel.language),
    copyright: asString(channel.copyright),
    author: asString(channel['itunes:author']),
    image_url: itunesImage,
    category: itunesCategory,
    explicit,
    itunes_type: itunesType === 'serial' ? 'serial' : itunesType === 'episodic' ? 'episodic' : null,
    podcast_locked: podcastLocked,
    podcast_guid: asString(channel['podcast:guid']),
    verify_txt: parseTxtVerify(channel['podcast:txt']),
    license_identifier: channelLicense.identifier,
    license_url: channelLicense.url,
    people: parsePeople(channel['podcast:person']),
    items,
  }
}
