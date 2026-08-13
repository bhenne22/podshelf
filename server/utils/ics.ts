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
  recording_location_type: string | null
  recording_link: string | null
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
  // Whether REC events may disclose episodes.recording_link. True for the
  // authenticated per-user subscription feed; driven by the emitting
  // webhook's include_recording_link for the public single-event links.
  // The human-readable location label ("Remote", "In person") is never
  // withheld — it isn't a secret, only the room URL is.
  includeRecordingLink?: boolean
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

const RECORDING_LOCATION_LABELS: Record<string, string> = {
  in_person: 'In person',
  remote: 'Remote',
  mixed: 'Mixed (in person + remote)',
}

/**
 * LOCATION for the REC event. Calendar clients (Apple, Google, Outlook) all
 * linkify a bare URL here and surface it as the tappable "where" on the event,
 * which is exactly what you want 30 seconds before a remote recording. Falls
 * back to the plain label when there's no link to join.
 */
function buildRecordingLocation(ep: IcsEpisode, includeLink: boolean): string {
  const label = ep.recording_location_type
    ? RECORDING_LOCATION_LABELS[ep.recording_location_type] ?? ''
    : ''
  // recording_link is only ever populated for remote/mixed (enforced on the
  // write path), so no need to re-check the type here.
  if (includeLink && ep.recording_link) return ep.recording_link
  return label
}

/**
 * DROP events describe a publish date — there's nothing to join, so the
 * recording location is REC-only (`includeRecordingLocation`).
 */
function buildDescription(
  ep: IcsEpisode,
  includeRecordingLocation = false,
  includeLink = true,
): string {
  const parts: string[] = []
  const desc = descriptionText(ep.description)
  if (desc) parts.push(desc)

  if (includeRecordingLocation) {
    const label = ep.recording_location_type
      ? RECORDING_LOCATION_LABELS[ep.recording_location_type] ?? ''
      : ''
    const link = includeLink ? ep.recording_link : null
    // The link goes in DESCRIPTION as well as LOCATION: some clients (older
    // Outlook, a few Android widgets) don't linkify LOCATION, and the label
    // is the only place "Mixed" vs "Remote" is stated at all.
    if (label && link) parts.push(`Recording: ${label} — ${link}`)
    else if (label) parts.push(`Recording: ${label}`)
    else if (link) parts.push(`Recording link: ${link}`)
  }

  const url = episodeUrl(ep)
  if (url) parts.push(url)
  return parts.join('\n\n')
}

interface VEvent {
  uid: string
  summary: string
  description: string
  location?: string
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
  if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`)
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
  const includeLink = options.includeRecordingLink !== false

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
          description: buildDescription(ep, true, includeLink),
          location: buildRecordingLocation(ep, includeLink),
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
