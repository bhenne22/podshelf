import { createError } from 'h3'

/**
 * Validation + normalization for listener-submitted corrections.
 *
 * Split out of the endpoint so it can be unit-tested without an h3 event:
 * this is the only part of the public submit path with real branching, and
 * it's the part that faces the open internet.
 */

export const CORRECTION_STATUSES = ['new', 'confirmed', 'rejected', 'aired'] as const
export type CorrectionStatus = typeof CORRECTION_STATUSES[number]

export function isCorrectionStatus(x: unknown): x is CorrectionStatus {
  return typeof x === 'string' && (CORRECTION_STATUSES as readonly string[]).includes(x)
}

/** The long free-text fields. Generous, but not "paste a novel" generous. */
const MAX_LONG = 4000
/** Everything else — names, contacts, timecodes, slugs, URLs. */
const MAX_SHORT = 300

export interface CorrectionInput {
  podcastSlug: string
  episodeSlug: string | null
  timecode: string | null
  claim: string
  correction: string
  sourceUrl: string | null
  submitterName: string | null
  submitterContact: string | null
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function optional(v: unknown, field: string, max = MAX_SHORT): string | null {
  const s = str(v)
  if (!s) return null
  if (s.length > max) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be ${max} characters or fewer` })
  }
  return s
}

function required(v: unknown, field: string, max = MAX_LONG): string {
  const s = str(v)
  if (!s) {
    throw createError({ statusCode: 400, statusMessage: `${field} is required` })
  }
  if (s.length > max) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be ${max} characters or fewer` })
  }
  return s
}

/**
 * The source URL ends up as a clickable link in a Discord embed and in the
 * admin UI, so restrict it to http(s). A `javascript:` or `data:` scheme
 * here would be a stored-XSS vector aimed at the hosts, not the submitter.
 */
function sourceUrl(v: unknown): string | null {
  const s = optional(v, 'source_url')
  if (!s) return null
  let parsed: URL
  try {
    parsed = new URL(s)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'source_url must be a valid URL' })
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw createError({ statusCode: 400, statusMessage: 'source_url must be an http(s) URL' })
  }
  return parsed.toString()
}

/** True when the honeypot field was filled — i.e. this is a bot. */
export function isHoneypotTripped(body: Record<string, unknown>): boolean {
  return str(body.hp).length > 0
}

export function normalizeCorrectionInput(body: Record<string, unknown>): CorrectionInput {
  return {
    podcastSlug: required(body.podcast_slug, 'podcast_slug', MAX_SHORT),
    episodeSlug: optional(body.episode_slug, 'episode_slug'),
    timecode: optional(body.timecode, 'timecode', 40),
    claim: required(body.claim, 'claim'),
    correction: required(body.correction, 'correction'),
    sourceUrl: sourceUrl(body.source_url),
    submitterName: optional(body.name, 'name', 120),
    submitterContact: optional(body.contact, 'contact', 200),
  }
}
