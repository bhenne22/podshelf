import getDb from '../db/index'
import { assertPublicHttpUrl } from './ssrf'
import { loadWebhooksForEvent, sendPublishWebhook, type WebhookRow } from './webhook'
import { logAudit } from './audit'

/**
 * A publish announcement links to a page on a downstream static site, but
 * that page doesn't exist until the site's GitHub Actions build has run and
 * rsynced. Firing the webhook at publish time therefore posts a 404 link to
 * the channel — the whole reason this module exists.
 *
 * Instead of sending immediately, `queuePublishAnnouncement()` parks the
 * announcement and the scheduler probes the episode URL each tick. The
 * webhook goes out on the first 2xx. If the page never appears within
 * ANNOUNCE_MAX_WAIT_MINUTES the announcement is released anyway with an
 * audit warning — a late link beats an announcement that silently vanished
 * because a build broke.
 *
 * The gate only applies when the episode URL points at the podcast's own
 * website. Podcasts with no `website` set get a feed-anchor URL that is
 * live the moment the feed re-renders, so those send immediately.
 */
export const ANNOUNCE_MAX_WAIT_MINUTES = 30

/** Cap on a single liveness probe. Static hosts answer in well under this. */
const PROBE_TIMEOUT_MS = 10_000

export interface AnnouncePodcast {
  id: number
  slug: string
  title: string
  website: string | null
}

export interface AnnounceEpisode {
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

export interface WebhookResult {
  ok: boolean
  status?: number
  message?: string
  webhook_id: number
  scope: 'podcast' | 'network'
}

interface PendingRow {
  id: number
  podcast_id: number
  episode_id: number
  probe_url: string
  attempts: number
  deadline_at: string
  actor_user_id: number | null
  actor_api_key_id: number | null
}

/**
 * Where the announcement should point. When the podcast has a `website`,
 * that's the real listener-facing page — and the thing we have to wait for.
 * Without one, fall back to a feed anchor on Podshelf itself, which needs
 * no deploy.
 */
export function buildEpisodeUrl(
  podcast: AnnouncePodcast,
  episodeSlug: string,
): { url: string; needsDeploy: boolean } {
  const siteUrl = (process.env.SITE_URL || (useRuntimeConfig().public.siteUrl as string) || '').replace(/\/+$/, '')
  const websiteBase = (podcast.website || '').replace(/\/+$/, '')
  if (websiteBase) {
    return { url: `${websiteBase}/episodes/${episodeSlug}`, needsDeploy: true }
  }
  return { url: `${siteUrl}/feeds/${podcast.slug}.xml#${episodeSlug}`, needsDeploy: false }
}

/**
 * HEAD the episode page to see whether the deploy has landed. Follows
 * redirects because a statically generated Nuxt route is written as
 * `/episodes/<slug>/index.html` and Apache 301s the extensionless path to
 * the trailing-slash form. Falls back to GET for hosts that reject HEAD.
 *
 * Never throws — any failure reads as "not live yet."
 */
export async function probeEpisodeUrl(url: string): Promise<{ live: boolean; status?: number; error?: string }> {
  try {
    // The URL is derived from the admin-set `website` column, but it's still
    // a member-supplied value driving an outbound request from our network.
    await assertPublicHttpUrl(url)
  } catch (err) {
    return { live: false, error: err instanceof Error ? err.message : 'blocked url' }
  }

  const attempt = async (method: 'HEAD' | 'GET') => fetch(url, {
    method,
    redirect: 'follow',
    headers: { 'User-Agent': 'Podshelf' },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  })

  try {
    let res = await attempt('HEAD')
    // 405 Method Not Allowed / 501 Not Implemented — host doesn't do HEAD.
    if (res.status === 405 || res.status === 501) {
      res = await attempt('GET')
    }
    return { live: res.ok, status: res.status }
  } catch (err) {
    return { live: false, error: err instanceof Error ? err.message : 'probe failed' }
  }
}

function loadPodcast(podcastId: number): AnnouncePodcast | undefined {
  return getDb().prepare(`
    SELECT id, slug, title, website FROM podcasts WHERE id = ?
  `).get(podcastId) as AnnouncePodcast | undefined
}

function loadEpisode(episodeId: number): AnnounceEpisode | undefined {
  return getDb().prepare(`
    SELECT id, title, slug, description, audio_url, image_url,
           episode_number, season_number, published_at
    FROM episodes WHERE id = ?
  `).get(episodeId) as AnnounceEpisode | undefined
}

/**
 * POST every webhook subscribed to `episode.publish` for this podcast
 * (podcast-scoped + parent-network-scoped) and audit each result.
 *
 * Rows are re-read at delivery time rather than captured at queue time, so
 * a deferred announcement reflects any title/description fix made during
 * the wait.
 */
export async function deliverPublishWebhooks(
  podcastId: number,
  episodeId: number,
  actorUserId: number | null,
  actorApiKeyId: number | null,
): Promise<WebhookResult[]> {
  const podcast = loadPodcast(podcastId)
  const episode = loadEpisode(episodeId)
  if (!podcast || !episode) return []

  const webhooks = loadWebhooksForEvent(podcastId, 'episode.publish')
  if (webhooks.length === 0) return []

  const siteUrl = (process.env.SITE_URL || (useRuntimeConfig().public.siteUrl as string) || '').replace(/\/+$/, '')
  const feedUrl = `${siteUrl}/feeds/${podcast.slug}.xml`
  const { url: episodeUrl } = buildEpisodeUrl(podcast, episode.slug)

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

  return results
}

/**
 * Park a publish announcement until the episode page is reachable.
 *
 * Probes once inline before parking, so a podcast whose page is already
 * live (or whose URL needs no deploy at all) announces with no added
 * latency — the queue only costs time when the page genuinely isn't there.
 *
 * Returns the results if the webhooks went out now, or null if the
 * announcement was queued for the scheduler to release.
 */
export async function queuePublishAnnouncement(
  podcastId: number,
  episodeId: number,
  actorUserId: number | null,
  actorApiKeyId: number | null,
): Promise<WebhookResult[] | null> {
  const podcast = loadPodcast(podcastId)
  const episode = loadEpisode(episodeId)
  if (!podcast || !episode) return []

  // Nothing subscribed — don't queue work that will deliver nothing.
  if (loadWebhooksForEvent(podcastId, 'episode.publish').length === 0) return []

  const { url, needsDeploy } = buildEpisodeUrl(podcast, episode.slug)
  if (!needsDeploy) {
    return deliverPublishWebhooks(podcastId, episodeId, actorUserId, actorApiKeyId)
  }

  const probe = await probeEpisodeUrl(url)
  if (probe.live) {
    return deliverPublishWebhooks(podcastId, episodeId, actorUserId, actorApiKeyId)
  }

  // REPLACE (not IGNORE) so an unpublish → republish re-arms the wait with a
  // fresh deadline instead of inheriting the old row's expiry.
  getDb().prepare(`
    INSERT OR REPLACE INTO pending_announcements
      (podcast_id, episode_id, probe_url, attempts, last_status, last_error,
       actor_user_id, actor_api_key_id, deadline_at)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?, datetime('now', '+${ANNOUNCE_MAX_WAIT_MINUTES} minutes'))
  `).run(
    podcastId,
    episodeId,
    url,
    probe.status ?? null,
    probe.error ?? null,
    actorUserId,
    actorApiKeyId,
  )

  logAudit({
    podcastId,
    userId: actorUserId,
    apiKeyId: actorApiKeyId,
    action: 'webhook.publish.deferred',
    entityType: 'episode',
    entityId: episodeId,
    summary: `Announcement held until ${url} is live (waiting on the site build)`,
    details: { probe_url: url, status: probe.status, error: probe.error, max_wait_minutes: ANNOUNCE_MAX_WAIT_MINUTES },
  })

  return null
}

/**
 * Scheduler tick: re-probe every parked announcement and release the ones
 * whose page has appeared. Rows past their deadline are released anyway with
 * a warning in the audit log — the operator gets the announcement plus a
 * clear signal that the build didn't land.
 *
 * Rows are deleted before delivery so a slow webhook can't be double-sent by
 * an overlapping tick. Returns the number of announcements released.
 */
export async function processPendingAnnouncements(): Promise<number> {
  // Probes are network-bound and can outlive the 60s scheduler interval when
  // several are parked. Without this guard an overlapping tick would re-probe
  // rows the previous pass is still working through.
  if (releaseInFlight) return 0
  releaseInFlight = true
  try {
    return await releasePendingAnnouncements()
  } finally {
    releaseInFlight = false
  }
}

let releaseInFlight = false

async function releasePendingAnnouncements(): Promise<number> {
  const db = getDb()
  const rows = db.prepare(`
    SELECT id, podcast_id, episode_id, probe_url, attempts, deadline_at,
           actor_user_id, actor_api_key_id
    FROM pending_announcements
    ORDER BY id
  `).all() as PendingRow[]

  if (rows.length === 0) return 0

  const del = db.prepare('DELETE FROM pending_announcements WHERE id = ?')
  const bump = db.prepare(`
    UPDATE pending_announcements
    SET attempts = attempts + 1, last_status = ?, last_error = ?
    WHERE id = ?
  `)
  const isExpired = db.prepare(
    "SELECT datetime(deadline_at) <= datetime('now') AS expired FROM pending_announcements WHERE id = ?",
  )

  let released = 0
  for (const row of rows) {
    // The episode may have been deleted or reverted to draft while parked.
    const still = db.prepare(
      "SELECT status FROM episodes WHERE id = ?",
    ).get(row.episode_id) as { status: string } | undefined
    if (!still || still.status !== 'published') {
      del.run(row.id)
      continue
    }

    const probe = await probeEpisodeUrl(row.probe_url)
    const expired = ((isExpired.get(row.id) as { expired: number } | undefined)?.expired ?? 0) === 1

    if (!probe.live && !expired) {
      bump.run(probe.status ?? null, probe.error ?? null, row.id)
      continue
    }

    // Delete first: delivery is slow and the next tick must not pick this up.
    del.run(row.id)

    if (!probe.live) {
      logAudit({
        podcastId: row.podcast_id,
        userId: row.actor_user_id,
        apiKeyId: row.actor_api_key_id,
        action: 'webhook.publish.deferred.timeout',
        entityType: 'episode',
        entityId: row.episode_id,
        summary: `Announcing after ${ANNOUNCE_MAX_WAIT_MINUTES}m — ${row.probe_url} still isn't live, so the link may 404`,
        details: {
          probe_url: row.probe_url,
          status: probe.status,
          error: probe.error,
          attempts: row.attempts + 1,
        },
      })
    }

    try {
      await deliverPublishWebhooks(row.podcast_id, row.episode_id, row.actor_user_id, row.actor_api_key_id)
      released++
    } catch (err) {
      console.error('[announce] delivery failed', { episodeId: row.episode_id, err })
    }
  }

  return released
}
