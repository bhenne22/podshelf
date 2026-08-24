import getDb from '../db/index'
import { bumpFeedLastModified } from './feed-cache'
import {
  clearPublishDirty,
  dispatchRepositoryEvent,
  isDeploysPaused,
  loadGithubConfig,
} from './github'
import { queuePublishAnnouncement, type WebhookResult } from './announce'
import { logAudit } from './audit'

interface PublishablePodcast {
  id: number
  slug: string
  title: string
  website: string | null
}

/**
 * Source label tells the audit log + GitHub event-type which path took us
 * here. 'episode-create' / 'episode-update' for direct user actions;
 * 'episode-schedule' when the timer flips a scheduled episode.
 */
export type PublishSource = 'episode-create' | 'episode-update' | 'episode-schedule'

/**
 * Single fan-out point for "an episode just became live": bump the feed
 * cache, fire the GitHub repository_dispatch (when configured), and hand the
 * `episode.publish` webhooks to the announcement queue.
 *
 * The announcement is deliberately NOT sent inline. It links to a page on a
 * downstream static site that only exists once the build we just triggered
 * has deployed, so `queuePublishAnnouncement` holds it until the page
 * answers 200 (see server/utils/announce.ts). When the page is already live
 * — or the podcast has no website, so the link is a Podshelf feed anchor —
 * it sends immediately and this stays a single round trip.
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

  const podcast = db.prepare(`
    SELECT id, slug, title, website FROM podcasts WHERE id = ?
  `).get(podcastId) as PublishablePodcast | undefined
  if (!podcast) return {}

  // Every "became live" transition dispatches the rebuild immediately rather
  // than going through maybeAutoTrigger's 15-minute debounce. The debounce
  // exists to coalesce a flurry of human edits into one build; a go-live is
  // a single committed event, and making the announcement wait out the
  // debounce before the page could even start building added ~15 minutes of
  // dead time to every publish. Ordinary edits to already-published episodes
  // still take the debounced path.
  //
  // `episode-schedule` additionally bypasses the `github_auto_trigger` gate
  // (the user committed to the publish when they hit Schedule). The manual
  // paths still honor it — a podcast with auto-trigger off is built by hand.
  firePublishDispatch(podcast, episodeId, source)

  const results = await queuePublishAnnouncement(podcastId, episodeId, actorUserId, actorApiKeyId)
  return results ? { webhooks: results } : {}
}

/**
 * Fire-and-forget a repository_dispatch for an episode going live. Clears
 * any pending dirty markers so the debounced auto-publish path won't fire a
 * redundant build minutes later. Audits both success and failure.
 */
function firePublishDispatch(podcast: PublishablePodcast, episodeId: number, source: PublishSource): void {
  if (isDeploysPaused(podcast.id)) return
  const config = loadGithubConfig(podcast.id)
  if (!config) return
  // Scheduled go-lives bypass auto_trigger; manual publishes respect it.
  if (source !== 'episode-schedule' && !config.auto_trigger) return

  clearPublishDirty(podcast.id)

  const scheduled = source === 'episode-schedule'
  const payload = {
    slug: podcast.slug,
    reason: scheduled ? 'podshelf:scheduled-publish' : 'podshelf:publish',
    podcast_id: podcast.id,
    episode_id: episodeId,
    fired_at: new Date().toISOString(),
  }
  const action = scheduled ? 'podcast.github.scheduled-publish' : 'podcast.github.publish'
  const label = scheduled ? 'scheduled publish' : 'publish'

  void dispatchRepositoryEvent(config, payload)
    .then(() => {
      logAudit({
        podcastId: podcast.id,
        userId: null,
        action,
        entityType: 'episode',
        entityId: episodeId,
        summary: `Auto-fired GitHub rebuild for ${label}`,
      })
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[publish-event] ${label} dispatch failed for podcast ${podcast.id}: ${message}`)
      logAudit({
        podcastId: podcast.id,
        userId: null,
        action: `${action}.fail`,
        entityType: 'episode',
        entityId: episodeId,
        summary: `Auto-dispatch for ${label} failed: ${message}`,
        details: { error: message },
      })
    })
}
