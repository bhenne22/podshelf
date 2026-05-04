import getDb from '../db/index'

export interface NextEpisodeContext {
  next_season_number: number | null
  next_episode_number: number
}

/**
 * Pick sensible defaults for the next episode's numbers based on what's
 * already in the podcast.
 *
 *   - next_season_number = season of the most recently-created episode
 *     (any status). null when no episodes yet, or when the latest episode
 *     has no season set (an episodic show).
 *   - next_episode_number = max(episode_number) + 1 scoped to that season
 *     when one is set, else global max + 1. 1 when no episodes exist.
 *
 * These are suggestions — the user can edit them in the form before saving.
 */
export function suggestNextEpisodeContext(podcastId: number): NextEpisodeContext {
  const db = getDb()

  const latest = db.prepare(`
    SELECT season_number FROM episodes
    WHERE podcast_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(podcastId) as { season_number: number | null } | undefined

  const nextSeason = latest?.season_number ?? null

  const maxRow = nextSeason !== null
    ? db.prepare(`
        SELECT MAX(episode_number) AS m FROM episodes
        WHERE podcast_id = ? AND season_number = ?
      `).get(podcastId, nextSeason) as { m: number | null }
    : db.prepare(`
        SELECT MAX(episode_number) AS m FROM episodes WHERE podcast_id = ?
      `).get(podcastId) as { m: number | null }

  const nextEpisode = (maxRow.m ?? 0) + 1

  return {
    next_season_number: nextSeason,
    next_episode_number: nextEpisode,
  }
}

/**
 * Render template placeholders. Supported: {season}, {episode}, {date}.
 * Anything else is left as-is — no escaping behavior, since templates are
 * trusted (only podcast members can set them) and the description renders
 * as HTML in the editor.
 */
export function renderTemplate(
  template: string | null,
  ctx: { season: number | null; episode: number; date: string },
): string {
  if (!template) return ''
  return template
    .replace(/\{season\}/g, ctx.season != null ? String(ctx.season) : '')
    .replace(/\{episode\}/g, String(ctx.episode))
    .replace(/\{date\}/g, ctx.date)
}

export function todayYmd(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
