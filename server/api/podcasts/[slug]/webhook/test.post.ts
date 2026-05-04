import { defineEventHandler, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import { loadWebhookConfig, sendPublishWebhook } from '../../../../utils/webhook'
import getDb from '../../../../db/index'

/**
 * POST /api/podcasts/[slug]/webhook/test
 *
 * Fire a synthetic "test" episode through the webhook. Useful for
 * verifying the URL + format work before flipping `enabled` on.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)

  const config = loadWebhookConfig(podcastId)
  if (!config) {
    throw createError({ statusCode: 400, statusMessage: 'No webhook URL configured. Save one first.' })
  }

  const db = getDb()
  const podcast = db.prepare(`
    SELECT id, slug, title, website FROM podcasts WHERE id = ?
  `).get(podcastId) as { id: number; slug: string; title: string; website: string | null }

  const siteUrl = ((useRuntimeConfig().public.siteUrl as string) || '').replace(/\/+$/, '')
  const feedUrl = `${siteUrl}/feeds/${podcast.slug}.xml`

  const result = await sendPublishWebhook(
    config,
    { slug: podcast.slug, title: podcast.title, feed_url: feedUrl, website: podcast.website },
    {
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
    },
  )

  if (!result.ok) {
    throw createError({
      statusCode: 502,
      statusMessage: `Webhook failed${result.status ? ` (HTTP ${result.status})` : ''}: ${result.message ?? 'unknown error'}`,
    })
  }

  return { ok: true, status: result.status }
})
