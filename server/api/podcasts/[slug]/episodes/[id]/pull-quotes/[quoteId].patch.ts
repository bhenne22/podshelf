import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../../../utils/auth'
import { maybeAutoTrigger } from '../../../../../../utils/github'
import { logAudit } from '../../../../../../utils/audit'
import {
  requireEpisode,
  normalizePullQuote,
  normalizeTimecode,
  touchEpisodeForQuotes,
  PULL_QUOTE_COLUMNS,
  MAX_SPEAKER_LENGTH,
} from '../../../../../../utils/pull-quotes'
import getDb from '../../../../../../db/index'

/**
 * PATCH /api/podcasts/[slug]/episodes/[id]/pull-quotes/[quoteId]
 *
 * Body: any of { quote, speaker, timecode, position }. Partial — a field
 * that isn't in the body is left alone, and `null`/"" clears speaker or
 * timecode. `quote` can be edited but never emptied; delete the row instead.
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
  const existing = db.prepare('SELECT id FROM episode_pull_quotes WHERE id = ? AND episode_id = ?')
    .get(quoteId, id) as { id: number } | undefined
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Pull quote not found' })
  }

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

  touchEpisodeForQuotes(id)
  if (episode.status === 'published') {
    maybeAutoTrigger(podcastId, 'episode-pull-quotes-update')
  }

  logAudit(event, {
    podcastId,
    userId: user.id,
    action: 'episode.pull-quote.update',
    entityType: 'episode',
    entityId: id,
    summary: `Edited a pull quote on "${episode.title || 'Untitled episode'}"`,
  })

  return db.prepare(`SELECT ${PULL_QUOTE_COLUMNS} FROM episode_pull_quotes WHERE id = ?`).get(quoteId)
})
