import { createError } from 'h3'

const VALID_STATUSES = ['draft', 'published', 'scheduled']
const VALID_EPISODE_TYPES = ['full', 'trailer', 'bonus']
const VALID_EPISODE_EXPLICIT = ['true', 'false']
const VALID_RECORDING_LOCATION_TYPES = ['in_person', 'remote', 'mixed']
const VALID_TRANSCRIPT_TYPES = [
  'text/html',
  'text/plain',
  'application/srt',
  'application/x-subrip',
  'text/vtt',
  'application/json',
]

/**
 * Canonicalize a user-supplied datetime to ISO-8601 UTC so it stores, compares,
 * and renders consistently: SQLite's datetime() can parse it, bytewise
 * `ORDER BY published_at` stays chronological, and the feed's toRfc2822 reads it
 * as UTC. Returns null for empty/nullish input.
 *
 * A value with no timezone (a datetime-local "2026-07-06T14:00", a
 * space-separated "2026-07-06 14:00:00", or a date-only "2026-07-06") is treated
 * as UTC — matching how SQLite datetime() and the scheduled-flip comparison
 * already interpret it — rather than the server's local zone, which new Date()
 * would otherwise assume. Assumes the value already passed validateEpisodeFields;
 * returns the raw string unchanged if it somehow doesn't parse.
 */
export function normalizeIsoDate(value: unknown): string | null {
  if (value == null || value === '') return null
  const s = String(value).trim()
  // An ISO-shaped value with no timezone (date-only, "…T14:00", or space-
  // separated) is pinned to UTC. Anything with a Z/offset, or a non-ISO string,
  // falls through to new Date()'s own parsing.
  const isoNaive = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/.test(s)
  let toParse = s
  if (isoNaive) {
    toParse = s.replace(' ', 'T')
    if (!toParse.includes('T')) toParse += 'T00:00:00'
    toParse += 'Z'
  }
  const d = new Date(toParse)
  if (isNaN(d.getTime())) return String(value)
  return d.toISOString()
}

export function validateEpisodeFields(body: Record<string, unknown>) {
  if (body.episode_number != null) {
    const n = Number(body.episode_number)
    if (!Number.isInteger(n) || n < 1) {
      throw createError({ statusCode: 400, statusMessage: 'episode_number must be a positive integer' })
    }
  }

  if (body.season_number != null) {
    const n = Number(body.season_number)
    if (!Number.isInteger(n) || n < 1) {
      throw createError({ statusCode: 400, statusMessage: 'season_number must be a positive integer' })
    }
  }

  if (body.status != null && !VALID_STATUSES.includes(body.status as string)) {
    throw createError({ statusCode: 400, statusMessage: `status must be one of: ${VALID_STATUSES.join(', ')}` })
  }

  if (body.episode_type != null && !VALID_EPISODE_TYPES.includes(body.episode_type as string)) {
    throw createError({ statusCode: 400, statusMessage: `episode_type must be one of: ${VALID_EPISODE_TYPES.join(', ')}` })
  }

  if (body.itunes_explicit != null && body.itunes_explicit !== ''
      && !VALID_EPISODE_EXPLICIT.includes(body.itunes_explicit as string)) {
    throw createError({ statusCode: 400, statusMessage: `itunes_explicit must be 'true' or 'false'` })
  }

  if (body.transcript_type != null && body.transcript_type !== ''
      && !VALID_TRANSCRIPT_TYPES.includes(body.transcript_type as string)) {
    throw createError({
      statusCode: 400,
      statusMessage: `transcript_type must be one of: ${VALID_TRANSCRIPT_TYPES.join(', ')}`,
    })
  }

  if (body.published_at != null && body.published_at !== '') {
    const d = new Date(body.published_at as string)
    if (isNaN(d.getTime())) {
      throw createError({ statusCode: 400, statusMessage: 'published_at must be a valid date' })
    }
  }

  if (body.recording_starts_at != null && body.recording_starts_at !== '') {
    const d = new Date(body.recording_starts_at as string)
    if (isNaN(d.getTime())) {
      throw createError({ statusCode: 400, statusMessage: 'recording_starts_at must be a valid date' })
    }
  }

  if (body.recording_duration_minutes != null && body.recording_duration_minutes !== '') {
    const n = Number(body.recording_duration_minutes)
    if (!Number.isInteger(n) || n <= 0) {
      throw createError({ statusCode: 400, statusMessage: 'recording_duration_minutes must be a positive integer' })
    }
  }

  if (body.recording_location_type != null && body.recording_location_type !== ''
      && !VALID_RECORDING_LOCATION_TYPES.includes(body.recording_location_type as string)) {
    throw createError({
      statusCode: 400,
      statusMessage: `recording_location_type must be one of: ${VALID_RECORDING_LOCATION_TYPES.join(', ')}`,
    })
  }

  // The recording link becomes a clickable href in the episode form, so hold it
  // to the same http(s)-only rule as correction source_url — a `javascript:`
  // scheme here would be stored XSS aimed at the hosts.
  if (body.recording_link != null && body.recording_link !== '') {
    const s = String(body.recording_link).trim()
    if (s.length > 2048) {
      throw createError({ statusCode: 400, statusMessage: 'recording_link must be 2048 characters or fewer' })
    }
    let parsed: URL
    try {
      parsed = new URL(s)
    } catch {
      throw createError({ statusCode: 400, statusMessage: 'recording_link must be a valid URL' })
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw createError({ statusCode: 400, statusMessage: 'recording_link must be an http(s) URL' })
    }
  }
}

/**
 * Shared write-path rule for the recording-location pair: empty string means
 * "no value", and a link only makes sense for remote/mixed — an in_person (or
 * unspecified) episode always stores a NULL link, so the DB can't hold a link
 * the form no longer shows.
 */
export function normalizeRecordingLocation(
  locationType: unknown,
  link: unknown,
): { locationType: string | null; link: string | null } {
  const type = locationType == null || locationType === '' ? null : String(locationType)
  const raw = link == null || link === '' ? null : String(link).trim()
  const normalizedLink = raw === '' ? null : raw
  return {
    locationType: type,
    link: type === 'remote' || type === 'mixed' ? normalizedLink : null,
  }
}
