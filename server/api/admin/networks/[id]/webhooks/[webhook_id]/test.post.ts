import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { requireAdmin } from '../../../../../../utils/auth'
import {
  getWebhookFull,
  getWebhookSummary,
  isWebhookEvent,
  sendPublishWebhook,
  sendRecordingWebhook,
  type WebhookEvent,
} from '../../../../../../utils/webhook'
import getDb from '../../../../../../db/index'

/**
 * POST /api/admin/networks/[id]/webhooks/[webhook_id]/test
 *
 * Synthetic test using a stand-in podcast from the network's roster (first
 * active member by position). Body: { event? } picks which event flavor to
 * test; defaults to the first event the webhook subscribes to.
 */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const networkId = Number(getRouterParam(event, 'id'))
  const id = Number(getRouterParam(event, 'webhook_id'))
  if (!Number.isFinite(networkId) || !Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'network id + webhook id required' })
  }
  const summary = getWebhookSummary(id)
  if (!summary || summary.scope !== 'network' || summary.scope_id !== networkId) {
    throw createError({ statusCode: 404, statusMessage: 'Webhook not found' })
  }
  const full = getWebhookFull(id)
  if (!full) {
    throw createError({ statusCode: 400, statusMessage: 'Webhook URL is unreadable; rotate the secret and try again' })
  }

  const db = getDb()
  const standIn = db.prepare(`
    SELECT p.slug, p.title, p.website, p.timezone
    FROM network_podcasts np
    JOIN podcasts p ON p.id = np.podcast_id
    WHERE np.network_id = ? AND p.status = 'active'
    ORDER BY np.position, p.title
    LIMIT 1
  `).get(networkId) as { slug: string; title: string; website: string | null; timezone: string | null } | undefined

  const siteUrl = (process.env.SITE_URL || (useRuntimeConfig().public.siteUrl as string) || '').replace(/\/+$/, '')
  const podcastSlug = standIn?.slug ?? 'network-test'
  const podcastTitle = standIn?.title ?? 'Network Test'
  const feedUrl = `${siteUrl}/feeds/${podcastSlug}.xml`
  const podcastPayload = {
    slug: podcastSlug,
    title: podcastTitle,
    feed_url: feedUrl,
    website: standIn?.website ?? null,
  }

  const body = await readBody(event).catch(() => ({}))
  const requested: WebhookEvent = isWebhookEvent(body?.event)
    ? body.event
    : (summary.events[0] ?? 'episode.publish')

  let result: { ok: boolean; status?: number; message?: string }
  if (requested === 'episode.publish') {
    result = await sendPublishWebhook(full, podcastPayload, {
      title: 'Test episode from Podshelf (network webhook)',
      description: '<p>This is a test webhook fired from a network-scoped Podshelf webhook — no actual episode was published.</p>',
      episode_url: standIn?.website
        ? `${standIn.website.replace(/\/+$/, '')}/episodes/test`
        : `${siteUrl}/feeds/${podcastSlug}.xml#test`,
      audio_url: null,
      image_url: null,
      episode_number: null,
      season_number: null,
      published_at: new Date().toISOString(),
    })
  } else {
    const kind = requested === 'episode.recording.scheduled'
      ? 'scheduled' as const
      : requested === 'episode.recording.moved' ? 'moved' as const : 'cancelled' as const
    const now = new Date().toISOString()
    result = await sendRecordingWebhook(full, podcastPayload, {
      kind,
      episode_title: 'Test recording',
      episode_url: feedUrl,
      episode_number: null,
      season_number: null,
      new_starts_at: kind === 'cancelled' ? null : now,
      new_duration_minutes: kind === 'cancelled' ? null : 60,
      previous_starts_at: kind === 'scheduled' ? null : now,
      previous_duration_minutes: kind === 'scheduled' ? null : 60,
      podcast_timezone: standIn?.timezone ?? 'UTC',
    })
  }

  if (!result.ok) {
    throw createError({
      statusCode: 502,
      statusMessage: `Webhook failed${result.status ? ` (HTTP ${result.status})` : ''}: ${result.message ?? 'unknown error'}`,
    })
  }

  return { ok: true, status: result.status, event: requested }
})
