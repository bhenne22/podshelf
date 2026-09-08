import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../../../utils/auth'
import { logAudit } from '../../../../../../utils/audit'
import {
  requireEpisode,
  normalizePullQuote,
  normalizeTimecode,
  normalizeApproved,
  approvedQuotesFingerprint,
  syncEpisodeAfterQuoteWrite,
  PULL_QUOTE_COLUMNS,
  MAX_SPEAKER_LENGTH,
  type PullQuote,
} from '../../../../../../utils/pull-quotes'
import getDb from '../../../../../../db/index'

/**
 * PATCH /api/podcasts/[slug]/episodes/[id]/pull-quotes/[quoteId]
 *
 * Body: any of { quote, speaker, timecode, position, approved }. Partial — a
 * field that isn't in the body is left alone, and `null`/"" clears speaker or
 * timecode. `quote` can be edited but never emptied; delete the row instead.
 *
 * `approved` is the review gate: flipping it to true is what makes a quote
 * visible to a downstream site build. It gets its own audit action so the
 * log answers "who published this line" rather than burying it in a generic
 * field edit.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const id = Number(getRouterParam(event, 'id'))
  const quoteId = Number(getRouterParam(event, 'quoteId'))
  const { user, podcastId } = requirePodcastAccess(event, slug)

  const episode = requireEpisode(id, podcastId)
  if (!Number.isFinite(quoteId)) {
    throw createError({ statusCode: 400, statusMessage: 'quoteId required' })
  }

  const db = getDb()
  const existing = db.prepare('SELECT id, approved FROM episode_pull_quotes WHERE id = ? AND episode_id = ?')
    .get(quoteId, id) as { id: number; approved: number } | undefined
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Pull quote not found' })
  }
  const beforeFingerprint = approvedQuotesFingerprint(id)

  const body = await readBody(event)
  const updates: string[] = []
  const values: Record<string, unknown> = { id: quoteId, episode_id: id }

  if ('quote' in body) {
    // Reuse the create-path validator for the quote text itself by handing it
    // a minimal object — same required/length rules, same error wording.
    const normalized = normalizePullQuote({ quote: body.quote })
    updates.push('quote = @quote')
    values.quote = normalized.quote
  }
  if ('speaker' in body) {
    const speaker = body.speaker == null || String(body.speaker).trim() === ''
      ? null
      : String(body.speaker).trim()
    if (speaker && speaker.length > MAX_SPEAKER_LENGTH) {
      throw createError({
        statusCode: 400,
        statusMessage: `speaker must be ${MAX_SPEAKER_LENGTH} characters or fewer`,
      })
    }
    updates.push('speaker = @speaker')
    values.speaker = speaker
  }
  if ('timecode' in body) {
    updates.push('timecode = @timecode')
    values.timecode = normalizeTimecode(body.timecode)
  }
  if ('approved' in body) {
    updates.push('approved = @approved')
    values.approved = normalizeApproved(body.approved)
  }
  if ('position' in body) {
    const n = Number(body.position)
    if (!Number.isInteger(n) || n < 0) {
      throw createError({ statusCode: 400, statusMessage: 'position must be a non-negative integer' })
    }
    updates.push('position = @position')
    values.position = n
  }

  if (updates.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'No valid fields to update' })
  }

  updates.push(`updated_at = datetime('now')`)
  db.prepare(`
    UPDATE episode_pull_quotes SET ${updates.join(', ')}
    WHERE id = @id AND episode_id = @episode_id
  `).run(values)

  const updated = db.prepare(`SELECT ${PULL_QUOTE_COLUMNS} FROM episode_pull_quotes WHERE id = ?`)
    .get(quoteId) as PullQuote

  // Only re-sync and rebuild if this actually changed what a site would see.
  // A write touching unapproved rows is invisible downstream.
  syncEpisodeAfterQuoteWrite({
    episodeId: id,
    podcastId,
    episodeStatus: episode.status,
    before: beforeFingerprint,
  })

  // An approval flip is the moment a quote becomes publishable, so it gets
  // its own action and quotes the text — the audit log should be able to
  // answer "who approved this line" without a join back to the row.
  const approvedChanged = 'approved' in values && values.approved !== existing.approved
  const title = episode.title || 'Untitled episode'
  const preview = (updated as { quote: string }).quote
  logAudit(event, {
    podcastId,
    userId: user.id,
    action: approvedChanged
      ? (values.approved === 1 ? 'episode.pull-quote.approve' : 'episode.pull-quote.unapprove')
      : 'episode.pull-quote.update',
    entityType: 'episode',
    entityId: id,
    summary: approvedChanged
      ? `${values.approved === 1 ? 'Approved' : 'Unapproved'} a pull quote on "${title}": "${preview.slice(0, 120)}${preview.length > 120 ? '…' : ''}"`
      : `Edited a pull quote on "${title}"`,
  })

  return updated
})
