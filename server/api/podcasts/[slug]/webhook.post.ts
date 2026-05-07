import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../utils/auth'
import { saveWebhookConfig, type WebhookFormat } from '../../../utils/webhook'
import { logAudit } from '../../../utils/audit'

/**
 * POST /api/podcasts/[slug]/webhook
 *
 * Body: { url?, format, enabled }
 *
 * If `url` is omitted, the existing encrypted URL is preserved. Sending an
 * empty string explicitly clears the URL.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { user, podcastId } = requirePodcastAccess(event, slug)

  const body = await readBody(event)
  const format = body?.format
  if (format !== 'discord' && format !== 'slack' && format !== 'generic') {
    throw createError({ statusCode: 400, statusMessage: 'format must be discord, slack, or generic' })
  }
  const enabled = !!body?.enabled

  let url: string | undefined
  if ('url' in body) {
    url = String(body.url ?? '')
    if (url.trim() && !/^https?:\/\//i.test(url)) {
      throw createError({ statusCode: 400, statusMessage: 'url must start with http:// or https://' })
    }
  }

  saveWebhookConfig(podcastId, { format: format as WebhookFormat, enabled, url })

  logAudit(event, {
    podcastId,
    userId: user.id,
    action: 'podcast.webhook.update',
    entityType: 'podcast',
    entityId: podcastId,
    summary: `Updated publish webhook (${format}, ${enabled ? 'enabled' : 'disabled'})`,
  })

  return { ok: true }
})
