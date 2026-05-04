import { defineEventHandler, getRouterParam } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import {
  suggestNextEpisodeContext,
  renderTemplate,
  todayYmd,
} from '../../../../utils/episode-template'
import getDb from '../../../../db/index'

/**
 * GET /api/podcasts/[slug]/episodes/template
 *
 * Returns the rendered title + description templates and suggested
 * season/episode numbers for the New Episode form to pre-fill.
 *
 * Renders {season} / {episode} / {date} placeholders against the suggested
 * numbers. The user can edit anything before saving.
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)

  const db = getDb()
  const row = db.prepare(`
    SELECT episode_title_template, episode_description_template
    FROM podcasts WHERE id = ?
  `).get(podcastId) as {
    episode_title_template: string | null
    episode_description_template: string | null
  }

  const ctx = suggestNextEpisodeContext(podcastId)
  const renderCtx = {
    season: ctx.next_season_number,
    episode: ctx.next_episode_number,
    date: todayYmd(),
  }

  return {
    title: renderTemplate(row.episode_title_template, renderCtx),
    description: renderTemplate(row.episode_description_template, renderCtx),
    season_number: ctx.next_season_number,
    episode_number: ctx.next_episode_number,
  }
})
