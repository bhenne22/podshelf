import { defineEventHandler, readBody, getHeader, getRequestIP, createError } from 'h3'
import { createHash } from 'crypto'
import getDb from '../../db/index'
import { logAudit } from '../../utils/audit'
import { applyPublicCors } from '../../utils/public-cors'
import { fireCorrectionEvent } from '../../utils/correction-event'
import { normalizeCorrectionInput, isHoneypotTripped } from '../../utils/correction'

/**
 * POST /api/public/corrections
 *
 * Unauthenticated. This is where the downstream static sites' "report a
 * factual error" forms land — they're statically generated and have no
 * server of their own, so Podshelf receives the submission on their behalf.
 *
 * Anonymous write endpoints are a spam magnet, so there are three gates:
 * a honeypot field, a per-IP-hash hourly cap, and hard length limits in
 * normalizeCorrectionInput(). Only active podcasts accept submissions.
 */

/** Submissions allowed per IP hash per hour before we start refusing. */
const RATE_LIMIT_PER_HOUR = 5

interface PodcastRow {
  id: number
  slug: string
  status: string
}

export default defineEventHandler(async (event) => {
  applyPublicCors(event, getHeader(event, 'origin'))

  const body = (await readBody(event)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Body must be a JSON object' })
  }

  // Bots fill every field they find. Accept-and-discard rather than 400 —
  // a rejection tells the bot what to avoid next time.
  if (isHoneypotTripped(body)) {
    return { ok: true }
  }

  const input = normalizeCorrectionInput(body)

  const db = getDb()
  const podcast = db.prepare(`
    SELECT id, slug, status FROM podcasts WHERE slug = ?
  `).get(input.podcastSlug) as PodcastRow | undefined

  // Same 404 for "no such podcast" and "soft-deleted podcast" — an anonymous
  // caller shouldn't be able to enumerate which shows exist but are hidden.
  if (!podcast || podcast.status !== 'active') {
    throw createError({ statusCode: 404, statusMessage: 'Unknown podcast' })
  }

  const ip = getRequestIP(event, { xForwardedFor: true }) || '0.0.0.0'
  const ipHash = createHash('sha256').update(ip).digest('hex')

  const recent = db.prepare(`
    SELECT COUNT(*) AS n FROM corrections
    WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')
  `).get(ipHash) as { n: number }

  if (recent.n >= RATE_LIMIT_PER_HOUR) {
    throw createError({
      statusCode: 429,
      statusMessage: 'Too many corrections submitted. Try again in an hour.',
    })
  }

  // Resolve the episode within this podcast. An unmatched slug is not an
  // error — the raw slug is still stored so the hosts can see what the
  // listener meant even if it no longer resolves.
  const episode = input.episodeSlug
    ? (db.prepare(`
        SELECT id FROM episodes WHERE podcast_id = ? AND slug = ?
      `).get(podcast.id, input.episodeSlug) as { id: number } | undefined)
    : undefined

  const userAgent = (getHeader(event, 'user-agent') || '').slice(0, 500) || null

  const result = db.prepare(`
    INSERT INTO corrections (
      podcast_id, episode_id, episode_slug, timecode, claim, correction,
      source_url, submitter_name, submitter_contact, ip_hash, user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    podcast.id,
    episode?.id ?? null,
    input.episodeSlug,
    input.timecode,
    input.claim,
    input.correction,
    input.sourceUrl,
    input.submitterName,
    input.submitterContact,
    ipHash,
    userAgent,
  )

  const correctionId = Number(result.lastInsertRowid)

  logAudit({
    podcastId: podcast.id,
    userId: null,
    apiKeyId: null,
    action: 'correction.submit',
    entityType: 'correction',
    entityId: correctionId,
    summary: `Correction submitted${input.episodeSlug ? ` for ${input.episodeSlug}` : ''}${
      input.submitterName ? ` by ${input.submitterName}` : ''
    }`,
    details: {
      episode_slug: input.episodeSlug,
      timecode: input.timecode,
      has_source: Boolean(input.sourceUrl),
      has_contact: Boolean(input.submitterContact),
    },
  })

  // Bounded by WEBHOOK_TIMEOUT_MS inside the sender, and non-throwing — the
  // submitter's request never fails because a Discord webhook is down.
  await fireCorrectionEvent(podcast.id, correctionId)

  return { ok: true }
})
