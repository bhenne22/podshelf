import { encryptString, decryptString } from './crypto'
import getDb from '../db/index'

export interface GitHubConfig {
  owner: string
  repo: string
  event_type: string
  token: string
  auto_trigger: boolean
}

export interface GitHubConfigDescription {
  configured: boolean
  owner: string | null
  repo: string | null
  event_type: string | null
  has_token: boolean
  auto_trigger: boolean
  /**
   * Per-podcast deploy kill switch. When true, all repository_dispatch
   * paths (auto, manual, test) are blocked. Dirty markers still accumulate.
   */
  deploys_paused: boolean
  pending: PublishPendingDescription
}

export interface PublishPendingDescription {
  /** Timestamp of the first change in the current debounce window (ISO). */
  first_at: string | null
  /** Timestamp of the most recent change (ISO). Drives the countdown. */
  last_at: string | null
  /**
   * When the scheduler will fire — `last_at + PUBLISH_DEBOUNCE_MINUTES`.
   * Null if there's nothing pending. Always populated when last_at is set,
   * regardless of `auto_trigger` — the UI uses `auto_trigger` separately
   * to decide whether to show "auto-publishes at X" vs "auto-trigger off."
   */
  scheduled_for: string | null
  debounce_minutes: number
}

interface PodcastGithubRow {
  github_owner: string | null
  github_repo: string | null
  github_event_type: string | null
  github_token_encrypted: string | null
  github_auto_trigger: number
  deploys_paused: number
}

function loadRow(podcastId: number): PodcastGithubRow | null {
  const db = getDb()
  const row = db.prepare(`
    SELECT github_owner, github_repo, github_event_type,
           github_token_encrypted, github_auto_trigger, deploys_paused
    FROM podcasts WHERE id = ?
  `).get(podcastId) as PodcastGithubRow | undefined
  return row || null
}

/**
 * Returns true when the podcast's deploys are paused — used as the kill
 * switch for any repository_dispatch path (auto / manual / test). Dirty
 * markers still accumulate so unpause can fire a normal debounced build.
 */
export function isDeploysPaused(podcastId: number): boolean {
  const row = loadRow(podcastId)
  return !!row?.deploys_paused
}

export function setDeploysPaused(podcastId: number, paused: boolean): void {
  getDb().prepare(`
    UPDATE podcasts
    SET deploys_paused = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(paused ? 1 : 0, podcastId)
}

/**
 * Returns the full GitHub config including the decrypted token.
 * Only call from server code that needs to fire a dispatch.
 */
export function loadGithubConfig(podcastId: number): GitHubConfig | null {
  const row = loadRow(podcastId)
  if (!row) return null
  if (!row.github_owner || !row.github_repo || !row.github_event_type || !row.github_token_encrypted) {
    return null
  }
  return {
    owner: row.github_owner,
    repo: row.github_repo,
    event_type: row.github_event_type,
    token: decryptString(row.github_token_encrypted),
    auto_trigger: !!row.github_auto_trigger,
  }
}

/**
 * Returns a redacted view safe to send to the client UI.
 */
export function describeGithubConfig(podcastId: number): GitHubConfigDescription {
  const row = loadRow(podcastId)
  const pending = describePublishPending(podcastId)
  if (!row) {
    return {
      configured: false,
      owner: null, repo: null, event_type: null,
      has_token: false, auto_trigger: false,
      deploys_paused: false,
      pending,
    }
  }
  const hasToken = !!row.github_token_encrypted
  const allSet = !!(row.github_owner && row.github_repo && row.github_event_type && hasToken)
  return {
    configured: allSet,
    owner: row.github_owner,
    repo: row.github_repo,
    event_type: row.github_event_type,
    has_token: hasToken,
    auto_trigger: !!row.github_auto_trigger,
    deploys_paused: !!row.deploys_paused,
    pending,
  }
}

function describePublishPending(podcastId: number): PublishPendingDescription {
  const { first_at, last_at } = getPublishPending(podcastId)
  let scheduled_for: string | null = null
  if (last_at) {
    // SQLite datetimes are stored as 'YYYY-MM-DD HH:MM:SS' UTC strings.
    // Parse defensively: append 'Z' if there's no timezone marker so the
    // browser doesn't interpret it as local time.
    const iso = last_at.includes('T') ? last_at : last_at.replace(' ', 'T') + 'Z'
    const t = new Date(iso).getTime() + PUBLISH_DEBOUNCE_MINUTES * 60_000
    scheduled_for = new Date(t).toISOString()
  }
  return { first_at, last_at, scheduled_for, debounce_minutes: PUBLISH_DEBOUNCE_MINUTES }
}

export interface SaveGithubInput {
  owner: string
  repo: string
  event_type: string
  token?: string  // optional: if blank, keep existing
  auto_trigger: boolean
}

export function saveGithubConfig(podcastId: number, input: SaveGithubInput) {
  const db = getDb()
  const row = loadRow(podcastId)

  let encryptedToken: string | null = row?.github_token_encrypted ?? null
  if (input.token && input.token.trim()) {
    encryptedToken = encryptString(input.token.trim())
  }

  db.prepare(`
    UPDATE podcasts
    SET github_owner = ?,
        github_repo = ?,
        github_event_type = ?,
        github_token_encrypted = ?,
        github_auto_trigger = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    input.owner.trim(),
    input.repo.trim(),
    input.event_type.trim(),
    encryptedToken,
    input.auto_trigger ? 1 : 0,
    podcastId,
  )
}

export interface DispatchResult {
  ok: true
  status: number
}

/**
 * Fires a repository_dispatch event against GitHub. Throws on non-2xx
 * with the GitHub error message.
 */
export async function dispatchRepositoryEvent(
  config: GitHubConfig,
  clientPayload?: Record<string, unknown>,
): Promise<DispatchResult> {
  // GitHub PATs are pure ASCII. If someone pastes a token from a place that
  // injected smart quotes / status icons / etc., fetch will throw the cryptic
  // "Cannot convert argument to a ByteString" error from inside the
  // Authorization header. Catch that here with a useful message.
  const token = config.token.trim()
  if (!/^[\x21-\x7e]+$/.test(token)) {
    const bad = [...token].find((ch) => ch.charCodeAt(0) > 126 || ch.charCodeAt(0) < 33)
    const code = bad ? bad.charCodeAt(0) : 0
    throw new Error(
      `GitHub token contains a non-ASCII character (U+${code.toString(16).toUpperCase().padStart(4, '0')}). ` +
      `Re-copy the token directly from GitHub — avoid pasting through anything that may have added smart quotes or status icons.`,
    )
  }

  const url = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/dispatches`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'Podshelf',
    },
    body: JSON.stringify({
      event_type: config.event_type,
      client_payload: clientPayload || {},
    }),
    // Cap the dispatch so a stalled GitHub connection can't hang the publish
    // path (fire-and-forget) or a manual/test request. On abort fetch throws,
    // which surfaces as a normal dispatch failure to the caller.
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    let detail = ''
    try {
      const body = await res.json() as { message?: string }
      detail = body?.message ? `: ${body.message}` : ''
    } catch {
      // ignore — GitHub didn't return JSON
    }
    throw new Error(`GitHub returned ${res.status} ${res.statusText}${detail}`)
  }

  // 204 No Content is the expected success response
  return { ok: true, status: res.status }
}

/**
 * Number of minutes of quiet time after the most recent change before the
 * scheduler fires the auto-publish dispatch. Coalesces flurries of edits
 * into a single GitHub Actions build.
 */
export const PUBLISH_DEBOUNCE_MINUTES = 15

/**
 * Used by auto-trigger hooks scattered across the API. Instead of firing
 * a GitHub dispatch immediately, mark the podcast as having pending
 * changes; the in-process scheduler will fire one consolidated dispatch
 * PUBLISH_DEBOUNCE_MINUTES after the most recent change. The function
 * keeps its old name + signature so existing call sites continue to work.
 */
export function maybeAutoTrigger(podcastId: number, _reason: string) {
  try {
    const row = loadRow(podcastId)
    if (!row || !row.github_auto_trigger) return
    markPublishDirty(podcastId)
  } catch (err) {
    console.error(`[github] mark-dirty error for podcast ${podcastId}: ${(err as Error)?.message || err}`)
  }
}

/**
 * Stamps `publish_dirty_last_at = now`. Sets `publish_dirty_first_at`
 * the first time after a clear, otherwise leaves it pinned at the original
 * timestamp so the UI can show "dirty since 2:13 PM".
 */
export function markPublishDirty(podcastId: number) {
  getDb().prepare(`
    UPDATE podcasts
    SET publish_dirty_first_at = COALESCE(publish_dirty_first_at, datetime('now')),
        publish_dirty_last_at  = datetime('now')
    WHERE id = ?
  `).run(podcastId)
}

/**
 * Clears the dirty markers — call after a successful dispatch (manual or
 * scheduler-driven) so the banner disappears and the next change starts a
 * fresh window.
 */
export function clearPublishDirty(podcastId: number) {
  getDb().prepare(`
    UPDATE podcasts
    SET publish_dirty_first_at = NULL,
        publish_dirty_last_at  = NULL
    WHERE id = ?
  `).run(podcastId)
}

export interface PublishPendingState {
  first_at: string | null
  last_at: string | null
}

export function getPublishPending(podcastId: number): PublishPendingState {
  return (getDb().prepare(`
    SELECT publish_dirty_first_at AS first_at,
           publish_dirty_last_at  AS last_at
    FROM podcasts WHERE id = ?
  `).get(podcastId) as PublishPendingState | undefined) || { first_at: null, last_at: null }
}
