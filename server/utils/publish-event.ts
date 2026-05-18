import getDb from '../db/index'
import { bumpFeedLastModified } from './feed-cache'
import { maybeAutoTrigger } from './github'
import { loadWebhooksForEvent, sendPublishWebhook, type WebhookRow } from './webhook'
import { logAudit } from './audit'

interface PublishablePodcast {
  id: number
  slug: string
  title: string
  website: string | null
}

interface PublishableEpisode {
  id: number
  title: string
  slug: string
  description: string | null
  audio_url: string | null
  image_url: string | null
  episode_number: number | null
  season_number: number | null
  published_at: string | null
}

/**
 * Source label tells the audit log + GitHub event-type which path took us
 * here. 'episode-create' / 'episode-update' for direct user actions;
 * 'episode-schedule' when the timer flips a scheduled episode.
 */
export type PublishSource = 'episode-create' | 'episode-update' | 'episode-schedule'

interface WebhookResult {
  ok: boolean
  status?: number
  message?: string
  webhook_id: number
  scope: 'podcast' | 'network'
}

/**
 * Single fan-out point for "an episode just became live": bump the feed
 * cache, fire the GitHub repository_dispatch (when configured), and POST
 * every webhook subscribed to `episode.publish` (podcast-scoped + parent
 * network-scoped).
 *
 * Webhook errors are captured (not thrown) and returned in the result so
 * callers can surface them in the audit log without breaking the publish.
 */
export async function firePublishEvent(
  podcastId: number,
  episodeId: number,
  source: PublishSource,
  actorUserId: number | null = null,
  actorApiKeyId: number | null = null,
): Promise<{ webhooks?: WebhookResult[] }> {
  const db = getDb()

  bumpFeedLastModified(podcastId)
  maybeAutoTrigger(podcastId, source)

  const podcast = db.prepare(`
    SELECT id, slug, title, website FROM podcasts WHERE id = ?
  `).get(podcastId) as PublishablePodcast | undefined
  if (!podcast) return {}

  const episode = db.prepare(`
    SELECT id, title, slug, description, audio_url, image_url,
           episode_number, season_number, published_at
    FROM episodes WHERE id = ?
  `).get(episodeId) as PublishableEpisode | undefined
  if (!episode) return {}

  const webhooks = loadWebhooksForEvent(podcastId, 'episode.publish')
  if (webhooks.length === 0) return {}

  const siteUrl = (process.env.SITE_URL || (useRuntimeConfig().public.siteUrl as string) || '').replace(/\/+$/, '')
  const feedUrl = `${siteUrl}/feeds/${podcast.slug}.xml`
  const websiteBase = (podcast.website || '').replace(/\/+$/, '')
  const episodeUrl = websiteBase
    ? `${websiteBase}/episodes/${episode.slug}`
    : `${siteUrl}/feeds/${podcast.slug}.xml#${episode.slug}`

  const podcastPayload = { slug: podcast.slug, title: podcast.title, feed_url: feedUrl, website: podcast.website }
  const episodePayload = {
    title: episode.title,
    description: episode.description,
    episode_url: episodeUrl,
    audio_url: episode.audio_url,
    image_url: episode.image_url,
    episode_number: episode.episode_number,
    season_number: episode.season_number,
    published_at: episode.published_at,
  }

  const results = await Promise.all(
    webhooks.map(async (w: WebhookRow): Promise<WebhookResult> => {
      const r = await sendPublishWebhook(w, podcastPayload, episodePayload)
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
      userId: actorUserId,
      apiKeyId: actorApiKeyId,
      action: r.ok ? 'webhook.publish.ok' : 'webhook.publish.fail',
      entityType: 'episode',
      entityId: episodeId,
      summary: r.ok
        ? `Webhook fired (${w.format}, ${r.scope}#${w.id}${w.name ? ` "${w.name}"` : ''})`
        : `Webhook failed (${w.format}, ${r.scope}#${w.id}${w.name ? ` "${w.name}"` : ''}): ${r.message ?? 'unknown'}`,
      details: { format: w.format, scope: r.scope, webhook_id: w.id, status: r.status, message: r.message },
    })
  }

  return { webhooks: results }
}
