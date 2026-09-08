import { defineEventHandler, readBody, getRouterParam } from 'h3'
import { requirePodcastAccess } from '../../../../../utils/auth'
import { logAudit } from '../../../../../utils/audit'
import {
  requireEpisode,
  normalizePullQuote,
  nextPullQuotePosition,
  approvedQuotesFingerprint,
  syncEpisodeAfterQuoteWrite,
  PULL_QUOTE_COLUMNS,
} from '../../../../../utils/pull-quotes'
import getDb from '../../../../../db/index'

/**
 * POST /api/podcasts/[slug]/episodes/[id]/pull-quotes
 *
 * Body: { quote, speaker?, timecode?, position? }
 *
 * Appends one pull quote. For a transcript job importing a batch, use
 * POST .../pull-quotes/bulk instead — it's one transaction and supports
 * replace mode.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const id = Number(getRouterParam(event, 'id'))
  const { user, podcastId } = requirePodcastAccess(event, slug)

  const episode = requireEpisode(id, podcastId)
  const beforeFingerprint = approvedQuotesFingerprint(id)

  const body = await readBody(event)
  const normalized = normalizePullQuote(body)

  const db = getDb()
  const position = body?.position == null || body.position === ''
    ? nextPullQuotePosition(id)
    : Number(body.position)

  const result = db.prepare(`
    INSERT INTO episode_pull_quotes (episode_id, quote, speaker, timecode, position)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, normalized.quote, normalized.speaker, normalized.timecode, position)

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
    action: 'episode.pull-quote.create',
    entityType: 'episode',
    entityId: id,
    summary: `Added a pull quote to "${episode.title || 'Untitled episode'}"`,
  })

  event.node.res.statusCode = 201
  return db.prepare(`SELECT ${PULL_QUOTE_COLUMNS} FROM episode_pull_quotes WHERE id = ?`)
    .get(Number(result.lastInsertRowid))
})
