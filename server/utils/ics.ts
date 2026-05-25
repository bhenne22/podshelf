// iCalendar (RFC 5545) generation for podcast schedule feeds.
//
// Emits one VCALENDAR per call with up to two VEVENTs per episode:
//   - REC event when recording_starts_at IS NOT NULL
//   - DROP event when status IN ('scheduled','published') AND published_at IS NOT NULL
//
// Stable UIDs let calendar clients update existing events when the source
// changes instead of duplicating. LAST-MODIFIED from episodes.updated_at
// makes calendar diffing free.

import { decodeEntities } from './text'

// Source for the UID domain. Picked to be a stable identifier for this
// installation regardless of the feed URL. Calendar clients match on UID,
// so changing this would orphan every existing subscriber's events.
const UID_DOMAIN = 'podshelf.hennemo.com'

export type IcsScopeKind = 'podcast' | 'network'

export interface IcsEpisode {
  id: number
  title: string
  slug: string
  description: string | null
  status: string
  published_at: string | null
  recording_starts_at: string | null
  recording_duration_minutes: number | null
  updated_at: string
  // For the per-podcast feed both of these resolve to the same show; for the
  // network feed they vary row-by-row.
  podcast_title: string
  podcast_website: string | null
}

export interface IcsFeedOptions {
  scopeKind: IcsScopeKind
  // Human-readable name for the calendar (X-WR-CALNAME).
  calendarName: string
  // Subscriber's local timezone is irrelevant — all timed events render in
  // UTC. Default recording duration applies when an episode itself has
  // none set.
  defaultDurationMinutes?: number | null
}

// Per the calendar's plan:
//   REC: SUMMARY = "REC: <show> — E12: <title>" (network) / "REC: E12: <title>" (podcast)
//   DROP: SUMMARY = "DROP: <show> — E12: <title>" / "DROP: E12: <title>"
// We don't actually have episode_number in the projection here (callers can
// fold it into title); keep this generator agnostic to numbering. Network
// vs. podcast scope is the only delta in summary phrasing.

const PRODID = '-//Podshelf//Schedule v1//EN'

// CRLF is required by RFC 5545. Most clients tolerate LF but Apple Calendar
// and some Outlook versions silently drop properties when EOLs are wrong.
const CRLF = '\r\n'

/**
 * Escape a string for iCalendar TEXT property values (SUMMARY, DESCRIPTION,
 * LOCATION). Escape order matters: backslash must come first, otherwise the
 * other escapes' inserted backslashes would themselves be escaped.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\n')
}

/**
 * RFC 5545 line folding: lines over 75 octets MUST be split with CRLF + a
 * single whitespace (the unfolder strips the CRLF+space and rejoins). We
 * count by bytes (utf-8 length) since the limit is in octets, not chars —
 * a string with emoji can be under 75 chars but over 75 bytes.
 */
function foldLine(line: string): string {
  const enc = new TextEncoder()
  const bytes = enc.encode(line)
  if (bytes.length <= 75) return line

  // Walk the original string char-by-char, tracking byte length of the
  // current segment. Char-level rather than byte-level so we never split
  // a multi-byte sequence mid-codepoint.
  const out: string[] = []
  let current = ''
  let currentBytes = 0
  // First segment uses the full 75 budget; continuation lines start with
  // a leading space that counts toward their own 75.
  let budget = 75
  for (const ch of line) {
    const chBytes = enc.encode(ch).length
    if (currentBytes + chBytes > budget) {
      out.push(current)
      current = ch
      currentBytes = chBytes
      budget = 74 // continuation lines reserve 1 byte for the leading space
    } else {
      current += ch
      currentBytes += chBytes
    }
  }
  if (current.length > 0) out.push(current)
  return out.map((seg, i) => (i === 0 ? seg : ' ' + seg)).join(CRLF)
}

/** Format a JS Date as the YYYYMMDDTHHMMSSZ form used by DTSTAMP/DTSTART. */
function fmtUtc(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  )
}

/** All-day VALUE=DATE form: YYYYMMDD in the episode's intended date. */
function fmtDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
}

/**
 * Best-effort plain-text from a description that may contain HTML. Calendar
 * descriptions render as plain text, so tags must be stripped. Decode HTML
 * entities and collapse whitespace; truncate to keep the cal entry tidy.
 */
function descriptionText(raw: string | null | undefined, maxChars = 400): string {
  if (!raw) return ''
  // Strip tags first so entities inside attribute values don't survive.
  const noTags = raw.replace(/<[^>]+>/g, ' ')
  const decoded = decodeEntities(noTags)
  const collapsed = decoded.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= maxChars) return collapsed
  // Trim on a word boundary if one is nearby.
  const trimmed = collapsed.slice(0, maxChars)
  const lastSpace = trimmed.lastIndexOf(' ')
  return (lastSpace > maxChars - 40 ? trimmed.slice(0, lastSpace) : trimmed) + '…'
}

function episodeUrl(ep: IcsEpisode): string {
  const base = (ep.podcast_website || '').replace(/\/+$/, '')
  return base ? `${base}/episodes/${ep.slug}` : ''
}

function buildSummary(prefix: 'REC' | 'DROP', ep: IcsEpisode, scope: IcsScopeKind): string {
  const showPrefix = scope === 'network' ? `${ep.podcast_title} — ` : ''
  return `${prefix}: ${showPrefix}${ep.title || 'Untitled episode'}`
}

function buildDescription(ep: IcsEpisode): string {
  const desc = descriptionText(ep.description)
  const url = episodeUrl(ep)
  if (desc && url) return `${desc}\n\n${url}`
  return desc || url || ''
}

interface VEvent {
  uid: string
  summary: string
  description: string
  url: string
  status: 'CONFIRMED' | 'TENTATIVE'
  lastModified: Date
  dtstamp: Date
  // Either a timed event (start + end as UTC instants) or all-day (date-only).
  variant:
    | { kind: 'timed'; start: Date; end: Date }
    | { kind: 'allDay'; date: Date }
}

function renderVEvent(ev: VEvent): string {
  const lines: string[] = ['BEGIN:VEVENT']
  lines.push(`UID:${ev.uid}`)
  lines.push(`DTSTAMP:${fmtUtc(ev.dtstamp)}`)
  lines.push(`LAST-MODIFIED:${fmtUtc(ev.lastModified)}`)
  lines.push(`STATUS:${ev.status}`)
  if (ev.variant.kind === 'timed') {
    lines.push(`DTSTART:${fmtUtc(ev.variant.start)}`)
    lines.push(`DTEND:${fmtUtc(ev.variant.end)}`)
  } else {
    lines.push(`DTSTART;VALUE=DATE:${fmtDate(ev.variant.date)}`)
  }
  lines.push(`SUMMARY:${escapeText(ev.summary)}`)
  if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`)
  if (ev.url) lines.push(`URL:${ev.url}`) // URL is a CAL-ADDRESS-like value, not TEXT — no escape
  lines.push('END:VEVENT')
  return lines.map(foldLine).join(CRLF)
}

/**
 * Render the iCalendar payload as a string. Caller is responsible for
 * setting the Content-Type header.
 */
export function renderIcsFeed(episodes: IcsEpisode[], options: IcsFeedOptions): string {
  const now = new Date()
  const events: VEvent[] = []

  for (const ep of episodes) {
    const lastModified = parseDate(ep.updated_at) || now

    // REC event — exists only if a recording slot is set.
    if (ep.recording_starts_at) {
      const start = parseDate(ep.recording_starts_at)
      if (start) {
        const durationMinutes =
          (ep.recording_duration_minutes && ep.recording_duration_minutes > 0)
            ? ep.recording_duration_minutes
            : (options.defaultDurationMinutes && options.defaultDurationMinutes > 0
                ? options.defaultDurationMinutes
                : 90)
        const end = new Date(start.getTime() + durationMinutes * 60_000)
        events.push({
          uid: `episode-${ep.id}-rec@${UID_DOMAIN}`,
          summary: buildSummary('REC', ep, options.scopeKind),
          description: buildDescription(ep),
          url: episodeUrl(ep),
          status: 'CONFIRMED',
          lastModified,
          dtstamp: now,
          variant: { kind: 'timed', start, end },
        })
      }
    }

    // DROP event — scheduled or published episodes only.
    if (
      ep.published_at
      && (ep.status === 'scheduled' || ep.status === 'published')
    ) {
      const dropDate = parseDate(ep.published_at)
      if (dropDate) {
        events.push({
          uid: `episode-${ep.id}-drop@${UID_DOMAIN}`,
          summary: buildSummary('DROP', ep, options.scopeKind),
          description: buildDescription(ep),
          url: episodeUrl(ep),
          status: ep.status === 'published' ? 'CONFIRMED' : 'TENTATIVE',
          lastModified,
          dtstamp: now,
          variant: { kind: 'allDay', date: dropDate },
        })
      }
    }
  }

  const calendarLines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    foldLine(`X-WR-CALNAME:${escapeText(options.calendarName)}`),
  ]
  for (const ev of events) calendarLines.push(renderVEvent(ev))
  calendarLines.push('END:VCALENDAR')

  // Trailing CRLF per spec.
  return calendarLines.join(CRLF) + CRLF
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}
