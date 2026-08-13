import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { requirePodcastAccess } from '../../../../../utils/auth'
import {
  getWebhookFull,
  getWebhookSummary,
  isWebhookEvent,
  sendPublishWebhook,
  sendRecordingWebhook,
  type WebhookEvent,
} from '../../../../../utils/webhook'
import getDb from '../../../../../db/index'

/**
 * POST /api/podcasts/[slug]/webhooks/[id]/test
 *
 * Fire a synthetic event through the webhook. Body: { event? } — defaults to
 * the first event the webhook subscribes to, or 'episode.publish'. Returns
 * 502 with the upstream status/message if the receiver rejects it.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'webhook id required' })
  }
  const summary = getWebhookSummary(id)
  if (!summary || summary.scope !== 'podcast' || summary.scope_id !== podcastId) {
    throw createError({ statusCode: 404, statusMessage: 'Webhook not found' })
  }
  const full = getWebhookFull(id)
  if (!full) {
    throw createError({ statusCode: 400, statusMessage: 'Webhook URL is unreadable; rotate the secret and try again' })
  }

  const body = await readBody(event).catch(() => ({}))
  const requested: WebhookEvent = isWebhookEvent(body?.event)
    ? body.event
    : (summary.events[0] ?? 'episode.publish')

  const db = getDb()
  const podcast = db.prepare(`
    SELECT id, slug, title, website, timezone FROM podcasts WHERE id = ?
  `).get(podcastId) as { id: number; slug: string; title: string; website: string | null; timezone: string | null }

  const siteUrl = (process.env.SITE_URL || (useRuntimeConfig().public.siteUrl as string) || '').replace(/\/+$/, '')
  const feedUrl = `${siteUrl}/feeds/${podcast.slug}.xml`
  const podcastPayload = { slug: podcast.slug, title: podcast.title, feed_url: feedUrl, website: podcast.website }

  let result: { ok: boolean; status?: number; message?: string }
  if (requested === 'episode.publish') {
    result = await sendPublishWebhook(full, podcastPayload, {
      title: 'Test episode from Podshelf',
      description: '<p>This is a test webhook fired from Podshelf settings — no actual episode was published.</p>',
      episode_url: podcast.website
        ? `${podcast.website.replace(/\/+$/, '')}/episodes/test`
        : `${siteUrl}/feeds/${podcast.slug}.xml#test`,
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
      podcast_timezone: podcast.timezone || 'UTC',
      // Exercise the "Where"/"Join" rendering so the test message looks like
      // a real remote-recording notification. The Join field only appears if
      // this webhook has include_recording_link on — which is the point of
      // the test send.
      recording_location_type: 'remote',
      recording_link: 'https://example.com/test-recording-room',
      // No real episode behind a test send, so a signed calendar link would
      // 404 on click. Better to omit it than hand out a dead link.
      calendar_url: null,
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
