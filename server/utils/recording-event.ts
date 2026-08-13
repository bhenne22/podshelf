import getDb from '../db/index'
import { loadWebhooksForEvent, sendRecordingWebhook, type RecordingChangeKind, type WebhookEvent, type WebhookRow } from './webhook'
import { signEventCalendarToken } from './event-calendar-token'
import { logAudit } from './audit'

interface PodcastRow {
  id: number
  slug: string
  title: string
  website: string | null
  timezone: string | null
}

interface EpisodeRow {
  id: number
  title: string
  slug: string
  episode_number: number | null
  season_number: number | null
  recording_location_type: string | null
  recording_link: string | null
}

export interface RecordingEventInput {
  podcastId: number
  episodeId: number
  kind: RecordingChangeKind
  newStartsAt: string | null
  newDurationMinutes: number | null
  previousStartsAt: string | null
  previousDurationMinutes: number | null
  actorUserId?: number | null
  actorApiKeyId?: number | null
}

interface WebhookResult {
  ok: boolean
  status?: number
  message?: string
  webhook_id: number
  scope: 'podcast' | 'network'
}

/**
 * Fire a recording-change notification across every webhook subscribed to
 * the matching `episode.recording.<kind>` event. Mirrors firePublishEvent's
 * contract: webhook errors are captured (never thrown) and surfaced via the
 * audit log so the originating mutation always succeeds.
 *
 * Distinct from publish events because the payload semantics are different
 * (a moved recording isn't a "new episode") and the webhook formatter needs
 * before/after timestamps that publish events don't carry.
 */
export async function fireRecordingEvent(
  input: RecordingEventInput,
): Promise<{ webhooks?: WebhookResult[] }> {
  const db = getDb()

  const podcast = db.prepare(`
    SELECT id, slug, title, website, timezone FROM podcasts WHERE id = ?
  `).get(input.podcastId) as PodcastRow | undefined
  if (!podcast) return {}

  const episode = db.prepare(`
    SELECT id, title, slug, episode_number, season_number,
           recording_location_type, recording_link
    FROM episodes WHERE id = ?
  `).get(input.episodeId) as EpisodeRow | undefined
  // For a delete-driven event the episode row is already gone — pull what
  // we need from the input.previous* values and skip the DB read. Callers
  // that delete must pass enough context (title, episode_number, etc.) via
  // a stashed snapshot before they DELETE; we accept null here and degrade.

  const eventName = `episode.recording.${input.kind}` as WebhookEvent
  const webhooks = loadWebhooksForEvent(input.podcastId, eventName)
  if (webhooks.length === 0) return {}

  const siteUrl = (process.env.SITE_URL || (useRuntimeConfig().public.siteUrl as string) || '').replace(/\/+$/, '')
  const feedUrl = `${siteUrl}/feeds/${podcast.slug}.xml`
  const websiteBase = (podcast.website || '').replace(/\/+$/, '')
  // For deleted episodes we still want a usable link — fall back to the
  // podcast feed if we can't construct a per-episode URL.
  const episodeUrl = episode && websiteBase
    ? `${websiteBase}/episodes/${episode.slug}`
    : feedUrl

  const podcastPayload = { slug: podcast.slug, title: podcast.title, feed_url: feedUrl, website: podcast.website }
  const recordingPayload = {
    kind: input.kind,
    episode_title: episode?.title ?? '(deleted episode)',
    episode_url: episodeUrl,
    episode_number: episode?.episode_number ?? null,
    season_number: episode?.season_number ?? null,
    new_starts_at: input.newStartsAt,
    new_duration_minutes: input.newDurationMinutes,
    previous_starts_at: input.previousStartsAt,
    previous_duration_minutes: input.previousDurationMinutes,
    podcast_timezone: podcast.timezone || 'UTC',
    recording_location_type: episode?.recording_location_type ?? null,
    recording_link: episode?.recording_link ?? null,
    // Filled in per-webhook below — the token bakes in what that specific
    // destination is allowed to disclose, so there's no one shared value.
    calendar_url: null as string | null,
  }

  // The "add to calendar" link only exists for a live recording slot, and
  // only two variants are ever needed (link disclosed / withheld) no matter
  // how many webhooks are subscribed — so mint each at most once.
  const calendarUrlCache = new Map<boolean, string | null>()
  function calendarUrlFor(includeLink: boolean): string | null {
    if (calendarUrlCache.has(includeLink)) return calendarUrlCache.get(includeLink)!
    let url: string | null = null
    // A cancelled recording has no slot left to add; without SITE_URL the
    // link would be relative and useless in a chat client.
    if (input.kind !== 'cancelled' && input.newStartsAt && siteUrl) {
      try {
        url = `${siteUrl}/schedule/event/${signEventCalendarToken(input.episodeId, includeLink)}.ics`
      } catch {
        // No NUXT_SECRET_KEY — degrade to no calendar link rather than
        // emitting an unsigned one or failing the whole notification.
        url = null
      }
    }
    calendarUrlCache.set(includeLink, url)
    return url
  }

  const results = await Promise.all(
    webhooks.map(async (w: WebhookRow): Promise<WebhookResult> => {
      const r = await sendRecordingWebhook(w, podcastPayload, {
        ...recordingPayload,
        calendar_url: calendarUrlFor(w.include_recording_link),
      })
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
      podcastId: input.podcastId,
      userId: input.actorUserId ?? null,
      apiKeyId: input.actorApiKeyId ?? null,
      action: r.ok ? 'webhook.recording.ok' : 'webhook.recording.fail',
      entityType: 'episode',
      entityId: input.episodeId,
      summary: r.ok
        ? `Recording webhook fired (${w.format}, ${input.kind}, ${r.scope}#${w.id}${w.name ? ` "${w.name}"` : ''})`
        : `Recording webhook failed (${w.format}, ${input.kind}, ${r.scope}#${w.id}${w.name ? ` "${w.name}"` : ''}): ${r.message ?? 'unknown'}`,
      details: {
        format: w.format,
        kind: input.kind,
        scope: r.scope,
        webhook_id: w.id,
        status: r.status,
        message: r.message,
      },
    })
  }

  return { webhooks: results }
}
