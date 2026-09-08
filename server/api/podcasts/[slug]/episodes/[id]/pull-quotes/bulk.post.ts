import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../../../utils/auth'
import { logAudit } from '../../../../../../utils/audit'
import {
  requireEpisode,
  normalizePullQuote,
  nextPullQuotePosition,
  listPullQuotes,
  approvedQuotesFingerprint,
  syncEpisodeAfterQuoteWrite,
  MAX_BULK_QUOTES,
} from '../../../../../../utils/pull-quotes'
import getDb from '../../../../../../db/index'

const VALID_MODES = ['append', 'replace']

/**
 * POST /api/podcasts/[slug]/episodes/[id]/pull-quotes/bulk
 *
 * Body: { quotes: [{ quote, speaker?, timecode? }, ...], mode?: 'append' | 'replace' }
 *
 * The entry point for the transcript-processing pipeline: generate quotes
 * from a finished transcript, POST them here in one call. Imported quotes are
 * always unapproved — approval is a human act and this endpoint cannot grant
 * it, so an `approved` field in the body is ignored. `mode: 'replace'`
 * clears the episode's existing quotes first, so re-running the job against
 * a re-cut transcript doesn't stack duplicates. Default is 'append'.
 *
 * The whole batch is validated BEFORE anything is written and applied in one
 * transaction — a bad row in the middle fails the request rather than
 * leaving the episode half-imported (which, in replace mode, would mean the
 * old quotes are gone and the new ones didn't land).
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const id = Number(getRouterParam(event, 'id'))
  const { user, podcastId } = requirePodcastAccess(event, slug)

  const episode = requireEpisode(id, podcastId)

  const body = await readBody(event)
  const mode = body?.mode == null || body.mode === '' ? 'append' : String(body.mode)
  if (!VALID_MODES.includes(mode)) {
    throw createError({ statusCode: 400, statusMessage: `mode must be one of: ${VALID_MODES.join(', ')}` })
  }

  const incoming = body?.quotes
  if (!Array.isArray(incoming)) {
    throw createError({ statusCode: 400, statusMessage: 'quotes must be an array' })
  }
  if (incoming.length > MAX_BULK_QUOTES) {
    throw createError({
      statusCode: 400,
      statusMessage: `quotes must contain ${MAX_BULK_QUOTES} entries or fewer (got ${incoming.length})`,
    })
  }
  // An empty array in append mode is a no-op, but in replace mode it's the
  // documented way to clear an episode's quotes — so it isn't an error.

  const normalized = incoming.map((raw, i) => normalizePullQuote(raw, `quotes[${i}]`))

  const beforeFingerprint = approvedQuotesFingerprint(id)

  const db = getDb()
  const insert = db.prepare(`
    INSERT INTO episode_pull_quotes (episode_id, quote, speaker, timecode, position)
    VALUES (?, ?, ?, ?, ?)
  `)

  const removed = db.transaction(() => {
    let deleted = 0
    if (mode === 'replace') {
      deleted = db.prepare('DELETE FROM episode_pull_quotes WHERE episode_id = ?').run(id).changes
    }
    let position = mode === 'replace' ? 0 : nextPullQuotePosition(id)
    for (const q of normalized) {
      insert.run(id, q.quote, q.speaker, q.timecode, position)
      position++
    }
    return deleted
  })()

  // Only re-sync and rebuild if this actually changed what a site would see.
  // A write touching unapproved rows is invisible downstream.
  syncEpisodeAfterQuoteWrite({
    episodeId: id,
    podcastId,
    episodeStatus: episode.status,
    before: beforeFingerprint,
  })

  logAudit(event, {
    podcastId,
    userId: user.id,
    action: 'episode.pull-quote.bulk',
    entityType: 'episode',
    entityId: id,
    summary: mode === 'replace'
      ? `Replaced pull quotes on "${episode.title || 'Untitled episode'}" (${removed} removed, ${normalized.length} added)`
      : `Imported ${normalized.length} pull quote${normalized.length === 1 ? '' : 's'} into "${episode.title || 'Untitled episode'}"`,
    details: { mode, added: normalized.length, removed },
  })

  return {
    mode,
    added: normalized.length,
    removed,
    // Freshly imported quotes are unapproved by definition, so echo the
    // full list rather than the (empty) approved view.
    pull_quotes: listPullQuotes(id, { includeUnapproved: true }),
  }
})
