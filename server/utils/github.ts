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
}

interface PodcastGithubRow {
  github_owner: string | null
  github_repo: string | null
  github_event_type: string | null
  github_token_encrypted: string | null
  github_auto_trigger: number
}

function loadRow(podcastId: number): PodcastGithubRow | null {
  const db = getDb()
  const row = db.prepare(`
    SELECT github_owner, github_repo, github_event_type,
           github_token_encrypted, github_auto_trigger
    FROM podcasts WHERE id = ?
  `).get(podcastId) as PodcastGithubRow | undefined
  return row || null
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
  if (!row) {
    return { configured: false, owner: null, repo: null, event_type: null, has_token: false, auto_trigger: false }
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
  }
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
 * Fire-and-forget version used by auto-trigger hooks. Catches its own
 * errors so the calling API request isn't blocked or failed by GitHub
 * issues.
 */
export function maybeAutoTrigger(podcastId: number, reason: string) {
  try {
    const config = loadGithubConfig(podcastId)
    if (!config || !config.auto_trigger) return
    // Don't await — let it run in the background
    dispatchRepositoryEvent(config, { reason, podcast_id: podcastId, fired_at: new Date().toISOString() })
      .catch((err) => {
        console.error(`[github] auto-trigger failed for podcast ${podcastId}: ${err?.message || err}`)
      })
  } catch (err) {
    console.error(`[github] auto-trigger setup error: ${(err as Error)?.message || err}`)
  }
}
