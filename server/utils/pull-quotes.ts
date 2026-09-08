import { createError } from 'h3'
import getDb from '../db/index'

/**
 * Shared write-path rules for episode pull quotes.
 *
 * Pull quotes never reach the RSS feed — they exist for downstream surfaces
 * (social cards, episode-page callouts) and are populated either by hand in
 * the episode editor or in bulk by the transcript-processing pipeline. They
 * DO form part of the episode payload downstream sync reads (via
 * `?include=pull_quotes`), so every write has to bump `episodes.updated_at`
 * for the incremental-sync invariant documented in server/db/schema.sql.
 */

export const MAX_QUOTE_LENGTH = 2000
export const MAX_SPEAKER_LENGTH = 200
export const MAX_TIMECODE_LENGTH = 32
/** Cap on one bulk import so a runaway transcript job can't insert forever. */
export const MAX_BULK_QUOTES = 200

/** The projection every pull-quote endpoint returns. */
export const PULL_QUOTE_COLUMNS =
  'id, episode_id, quote, speaker, timecode, position, created_at, updated_at'

export interface PullQuote {
  id: number
  episode_id: number
  quote: string
  speaker: string | null
  timecode: string | null
  position: number
  created_at: string
  updated_at: string
}

export interface NormalizedPullQuote {
  quote: string
  speaker: string | null
  timecode: string | null
}

// "14:32", "1:14:32", "00:14:32", optionally with fractional seconds.
// Anything else is rejected rather than stored, so a downstream renderer can
// print the string verbatim without re-parsing defensively.
const TIMECODE_RE = /^(?:\d{1,3}:)?\d{1,2}:\d{2}(?:\.\d{1,3})?$/

function emptyToNull(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  return s === '' ? null : s
}

/**
 * Validates a timecode string. Empty/nullish means "no timecode" — a quote
 * pulled from a transcript without alignment data is still a useful quote.
 */
export function normalizeTimecode(value: unknown, label = 'timecode'): string | null {
  const s = emptyToNull(value)
  if (s === null) return null
  if (s.length > MAX_TIMECODE_LENGTH) {
    throw createError({
      statusCode: 400,
      statusMessage: `${label} must be ${MAX_TIMECODE_LENGTH} characters or fewer`,
    })
  }
  if (!TIMECODE_RE.test(s)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${label} must look like MM:SS or HH:MM:SS (got "${s}")`,
    })
  }
  return s
}

/**
 * Validates one incoming pull quote. `label` prefixes the error message so a
 * bulk import can say which row of the batch was bad.
 */
export function normalizePullQuote(raw: unknown, label = 'quote'): NormalizedPullQuote {
  if (!raw || typeof raw !== 'object') {
    throw createError({ statusCode: 400, statusMessage: `${label}: expected an object` })
  }
  const body = raw as Record<string, unknown>

  const quote = typeof body.quote === 'string' ? body.quote.trim() : ''
  if (!quote) {
    throw createError({ statusCode: 400, statusMessage: `${label}: quote text is required` })
  }
  if (quote.length > MAX_QUOTE_LENGTH) {
    throw createError({
      statusCode: 400,
      statusMessage: `${label}: quote must be ${MAX_QUOTE_LENGTH} characters or fewer`,
    })
  }

  const speaker = emptyToNull(body.speaker)
  if (speaker && speaker.length > MAX_SPEAKER_LENGTH) {
    throw createError({
      statusCode: 400,
      statusMessage: `${label}: speaker must be ${MAX_SPEAKER_LENGTH} characters or fewer`,
    })
  }

  return {
    quote,
    speaker,
    timecode: normalizeTimecode(body.timecode, `${label}: timecode`),
  }
}

/**
 * Loads the episode, scoped to the podcast, or throws the 404/400 the
 * pull-quote endpoints all share.
 */
export function requireEpisode(episodeId: number, podcastId: number): { id: number; status: string; title: string } {
  if (!Number.isFinite(episodeId)) {
    throw createError({ statusCode: 400, statusMessage: 'episode id required' })
  }
  const row = getDb()
    .prepare('SELECT id, status, title FROM episodes WHERE id = ? AND podcast_id = ?')
    .get(episodeId, podcastId) as { id: number; status: string; title: string } | undefined
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Episode not found' })
  }
  return row
}

export function listPullQuotes(episodeId: number): PullQuote[] {
  return getDb()
    .prepare(`SELECT ${PULL_QUOTE_COLUMNS} FROM episode_pull_quotes WHERE episode_id = ? ORDER BY position, id`)
    .all(episodeId) as PullQuote[]
}

/** Next free position at the end of an episode's list. */
export function nextPullQuotePosition(episodeId: number): number {
  const row = getDb()
    .prepare('SELECT COALESCE(MAX(position), -1) AS p FROM episode_pull_quotes WHERE episode_id = ?')
    .get(episodeId) as { p: number }
  return row.p + 1
}

/**
 * Bump `episodes.updated_at` after a pull-quote write. Quotes ride in the
 * episode projection downstream sync reads, so skipping this would let a
 * site's incremental sync decide the episode was unchanged and never pick
 * the new quotes up. The feed is untouched, so there's deliberately no
 * bumpFeedLastModified() here.
 */
export function touchEpisodeForQuotes(episodeId: number) {
  getDb().prepare(`UPDATE episodes SET updated_at = datetime('now') WHERE id = ?`).run(episodeId)
}
