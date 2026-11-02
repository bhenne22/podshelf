import getDb from '../db/index'
import { assertPublicHttpUrl } from './ssrf'
import { loadWebhooksForEvent, sendPublishWebhook, sendStallWebhook, type WebhookRow } from './webhook'
import { logAudit } from './audit'

/**
 * A publish announcement links to a page on a downstream static site, but
 * that page doesn't exist until the site's GitHub Actions build has run and
 * rsynced. Firing the webhook at publish time therefore posts a 404 link to
 * the channel — the whole reason this module exists.
 *
 * Instead of sending immediately, `queuePublishAnnouncement()` parks the
 * announcement and the scheduler probes the episode URL each tick. The
 * webhook goes out on the first 2xx.
 *
 * If the page still isn't up after ANNOUNCE_STALL_ALERT_MINUTES, the build
 * almost certainly failed. The public announcement stays held and a one-shot
 * `episode.publish.stalled` alert goes to whoever subscribes to it (the
 * operator channel), so a broken deploy is noticed without posting a 404 link
 * to listeners. The scheduler keeps probing, so once the deploy is fixed the
 * announcement releases on its own. Only past ANNOUNCE_MAX_WAIT_MINUTES is it
 * released regardless, with an audit warning — a late link still beats an
 * announcement that silently vanished because a build broke.
 *
 * This used to release after 30 minutes, which on 2026-11-01 posted a
 * dead link to a public channel for an hour while the only signal of the
 * failed deploy sat in the audit log.
 *
 * The gate only applies when the episode URL points at the podcast's own
 * website. Podcasts with no `website` set get a feed-anchor URL that is
 * live the moment the feed re-renders, so those send immediately.
 */
export const ANNOUNCE_STALL_ALERT_MINUTES = 30
export const ANNOUNCE_MAX_WAIT_MINUTES = 24 * 60

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
  last_status: number | null
  last_error: string | null
  deadline_at: string
  stall_alerted_at: string | null
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
 * POST every webhook subscribed to `episode.publish.stalled` for this
 * podcast and audit the alert. Never throws — a failed alert must not stop
 * the release loop from processing the other parked rows.
 */
async function deliverStallWebhooks(
  row: PendingRow,
  lastStatus: number | null,
  lastError: string | null,
): Promise<void> {
  const podcast = loadPodcast(row.podcast_id)
  const episode = loadEpisode(row.episode_id)
  if (!podcast || !episode) return

  const webhooks = loadWebhooksForEvent(row.podcast_id, 'episode.publish.stalled')

  logAudit({
    podcastId: row.podcast_id,
    userId: row.actor_user_id,
    apiKeyId: row.actor_api_key_id,
    action: 'webhook.publish.stalled',
    entityType: 'episode',
    entityId: row.episode_id,
    summary: webhooks.length > 0
      ? `${row.probe_url} still isn't live after ${ANNOUNCE_STALL_ALERT_MINUTES}m — announcement held, stall alert sent to ${webhooks.length} webhook(s)`
      : `${row.probe_url} still isn't live after ${ANNOUNCE_STALL_ALERT_MINUTES}m — announcement held (no webhook subscribes to episode.publish.stalled)`,
    details: { probe_url: row.probe_url, status: lastStatus, error: lastError, webhooks: webhooks.length },
  })
  if (webhooks.length === 0) return

  const siteUrl = (process.env.SITE_URL || (useRuntimeConfig().public.siteUrl as string) || '').replace(/\/+$/, '')
  const podcastPayload = {
    slug: podcast.slug,
    title: podcast.title,
    feed_url: `${siteUrl}/feeds/${podcast.slug}.xml`,
    website: podcast.website,
  }
  const stall = {
    episode_title: episode.title,
    episode_url: row.probe_url,
    waited_minutes: ANNOUNCE_STALL_ALERT_MINUTES,
    max_wait_minutes: ANNOUNCE_MAX_WAIT_MINUTES,
    last_status: lastStatus,
    last_error: lastError,
  }

  for (const w of webhooks) {
    const r = await sendStallWebhook(w, podcastPayload, stall)
    if (!r.ok) {
      logAudit({
        podcastId: row.podcast_id,
        userId: row.actor_user_id,
        apiKeyId: row.actor_api_key_id,
        action: 'webhook.publish.stalled.fail',
        entityType: 'episode',
        entityId: row.episode_id,
        summary: `Stall alert failed (${w.format}, #${w.id}${w.name ? ` "${w.name}"` : ''}): ${r.message ?? 'unknown'}`,
        details: { format: w.format, webhook_id: w.id, status: r.status, message: r.message },
      })
    }
  }
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
 * whose page has appeared. A row still waiting after
 * ANNOUNCE_STALL_ALERT_MINUTES sends its one-shot stall alert and keeps
 * waiting. Rows past their deadline are released anyway with a warning in
 * the audit log.
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
    SELECT id, podcast_id, episode_id, probe_url, attempts, last_status, last_error,
           deadline_at, stall_alerted_at, actor_user_id, actor_api_key_id
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
  const isStalled = db.prepare(`
    SELECT datetime(created_at, '+${ANNOUNCE_STALL_ALERT_MINUTES} minutes') <= datetime('now') AS stalled
    FROM pending_announcements WHERE id = ?
  `)
  const markAlerted = db.prepare(
    "UPDATE pending_announcements SET stall_alerted_at = datetime('now') WHERE id = ?",
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
      const stalled = ((isStalled.get(row.id) as { stalled: number } | undefined)?.stalled ?? 0) === 1
      if (stalled && !row.stall_alerted_at) {
        // Mark before sending, same reason as the delete below: a slow
        // webhook must not let an overlapping tick alert twice.
        markAlerted.run(row.id)
        await deliverStallWebhooks(row, probe.status ?? null, probe.error ?? null)
      }
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
        summary: `Announcing after ${ANNOUNCE_MAX_WAIT_MINUTES / 60}h — ${row.probe_url} still isn't live, so the link may 404`,
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
