import getDb from '../db/index'
import { loadWebhooksForEvent, sendCorrectionWebhook, type WebhookRow } from './webhook'
import { logAudit } from './audit'

interface PodcastRow {
  id: number
  slug: string
  title: string
  website: string | null
}

interface CorrectionRow {
  id: number
  episode_id: number | null
  episode_slug: string | null
  timecode: string | null
  claim: string
  correction: string
  source_url: string | null
  submitter_name: string | null
  submitter_contact: string | null
}

interface WebhookResult {
  ok: boolean
  status?: number
  message?: string
  webhook_id: number
  scope: 'podcast' | 'network'
}

/**
 * Fan out a listener-submitted correction to every webhook subscribed to
 * `correction.submitted`. Same non-throwing contract as firePublishEvent and
 * fireRecordingEvent: delivery failures are captured into the audit log so a
 * dead Discord webhook never turns a listener's submission into a 500.
 *
 * Note the actor is always null — submissions are unauthenticated by design.
 */
export async function fireCorrectionEvent(
  podcastId: number,
  correctionId: number,
): Promise<{ webhooks?: WebhookResult[] }> {
  const db = getDb()

  const podcast = db.prepare(`
    SELECT id, slug, title, website FROM podcasts WHERE id = ?
  `).get(podcastId) as PodcastRow | undefined
  if (!podcast) return {}

  const row = db.prepare(`
    SELECT id, episode_id, episode_slug, timecode, claim, correction,
           source_url, submitter_name, submitter_contact
    FROM corrections WHERE id = ?
  `).get(correctionId) as CorrectionRow | undefined
  if (!row) return {}

  const webhooks = loadWebhooksForEvent(podcastId, 'correction.submitted')
  if (webhooks.length === 0) return {}

  const siteUrl = (process.env.SITE_URL || (useRuntimeConfig().public.siteUrl as string) || '').replace(/\/+$/, '')
  const feedUrl = `${siteUrl}/feeds/${podcast.slug}.xml`
  const websiteBase = (podcast.website || '').replace(/\/+$/, '')

  const episodeTitle = row.episode_id
    ? (db.prepare('SELECT title FROM episodes WHERE id = ?')
        .get(row.episode_id) as { title: string } | undefined)?.title ?? null
    : null

  const podcastPayload = {
    slug: podcast.slug,
    title: podcast.title,
    feed_url: feedUrl,
    website: podcast.website,
  }
  const correctionPayload = {
    correction_id: row.id,
    episode_title: episodeTitle,
    episode_slug: row.episode_slug,
    episode_url: row.episode_slug && websiteBase
      ? `${websiteBase}/episodes/${row.episode_slug}`
      : null,
    timecode: row.timecode,
    claim: row.claim,
    correction: row.correction,
    source_url: row.source_url,
    submitter_name: row.submitter_name,
    submitter_contact: row.submitter_contact,
    triage_url: `${siteUrl}/podcasts/${podcast.slug}/corrections`,
  }

  const results = await Promise.all(
    webhooks.map(async (w: WebhookRow): Promise<WebhookResult> => {
      const r = await sendCorrectionWebhook(w, podcastPayload, correctionPayload)
      return {
        ok: r.ok,
        status: r.status,
        message: r.message,
        webhook_id: w.id,
        scope: w.podcast_id !== null ? 'podcast' : 'network',
      }
    }),
  )

  for (const r of results) {
    const w = webhooks.find((x) => x.id === r.webhook_id)
    if (!w) continue
    logAudit({
      podcastId,
      userId: null,
      apiKeyId: null,
      action: r.ok ? 'webhook.correction.ok' : 'webhook.correction.fail',
      entityType: 'correction',
      entityId: correctionId,
      summary: r.ok
        ? `Correction webhook fired (${w.format}, ${r.scope}#${w.id}${w.name ? ` "${w.name}"` : ''})`
        : `Correction webhook failed (${w.format}, ${r.scope}#${w.id}${w.name ? ` "${w.name}"` : ''}): ${r.message ?? 'unknown'}`,
      details: {
        format: w.format,
        scope: r.scope,
        webhook_id: w.id,
        status: r.status,
        message: r.message,
      },
    })
  }

  return { webhooks: results }
}
