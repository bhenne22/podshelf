import getDb from '../db/index'
import { loadWebhookConfig, sendRecordingWebhook, type RecordingChangeKind } from './webhook'
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

/**
 * Fire a recording-change notification. Mirrors the contract of
 * firePublishEvent: webhook errors are captured (never thrown) and surfaced
 * via the audit log so the originating mutation always succeeds.
 *
 * Distinct from publish events because the payload semantics are different
 * (a moved recording isn't a "new episode") and the webhook formatter needs
 * before/after timestamps that publish events don't carry.
 */
export async function fireRecordingEvent(
  input: RecordingEventInput,
): Promise<{ webhook?: { ok: boolean; status?: number; message?: string } }> {
  const db = getDb()

  const podcast = db.prepare(`
    SELECT id, slug, title, website, timezone FROM podcasts WHERE id = ?
  `).get(input.podcastId) as PodcastRow | undefined
  if (!podcast) return {}

  const episode = db.prepare(`
    SELECT id, title, slug, episode_number, season_number FROM episodes WHERE id = ?
  `).get(input.episodeId) as EpisodeRow | undefined
  // For a delete-driven event the episode row is already gone — pull what
  // we need from the input.previous* values and skip the DB read. Callers
  // that delete must pass enough context (title, episode_number, etc.) via
  // a stashed snapshot before they DELETE; we accept null here and degrade.

  const config = loadWebhookConfig(input.podcastId)
  if (!config || !config.enabled) return {}

  const siteUrl = (process.env.SITE_URL || (useRuntimeConfig().public.siteUrl as string) || '').replace(/\/+$/, '')
  const feedUrl = `${siteUrl}/feeds/${podcast.slug}.xml`
  const websiteBase = (podcast.website || '').replace(/\/+$/, '')
  // For deleted episodes we still want a usable link — fall back to the
  // podcast feed if we can't construct a per-episode URL.
  const episodeUrl = episode && websiteBase
    ? `${websiteBase}/episodes/${episode.slug}`
    : feedUrl

  const result = await sendRecordingWebhook(
    config,
    { slug: podcast.slug, title: podcast.title, feed_url: feedUrl, website: podcast.website },
    {
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
    },
  )

  logAudit({
    podcastId: input.podcastId,
    userId: input.actorUserId ?? null,
    apiKeyId: input.actorApiKeyId ?? null,
    action: result.ok ? 'webhook.recording.ok' : 'webhook.recording.fail',
    entityType: 'episode',
    entityId: input.episodeId,
    summary: result.ok
      ? `Recording webhook fired (${config.format}, ${input.kind})`
      : `Recording webhook failed (${config.format}, ${input.kind}): ${result.message ?? 'unknown'}`,
    details: { format: config.format, kind: input.kind, status: result.status, message: result.message },
  })

  return { webhook: result }
}
