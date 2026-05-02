import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import { validateEpisodeFields } from '../../../../utils/validate'
import { maybeAutoTrigger } from '../../../../utils/github'
import getDb from '../../../../db/index'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * POST /api/podcasts/[slug]/episodes
 */
export default defineEventHandler(async (event) => {
  const slugParam = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slugParam)

  const body = await readBody(event)
  if (!body?.title) {
    throw createError({ statusCode: 400, statusMessage: 'title is required' })
  }
  validateEpisodeFields(body)

  const db = getDb()

  let slug = body.slug ? slugify(String(body.slug)) : slugify(String(body.title))
  if (!slug) {
    throw createError({ statusCode: 400, statusMessage: 'unable to derive a slug from title' })
  }

  // Slug uniqueness is per-podcast.
  if (db.prepare('SELECT 1 FROM episodes WHERE podcast_id = ? AND slug = ?').get(podcastId, slug)) {
    let suffix = 2
    let candidate = `${slug}-${suffix}`
    while (db.prepare('SELECT 1 FROM episodes WHERE podcast_id = ? AND slug = ?').get(podcastId, candidate)) {
      suffix++
      candidate = `${slug}-${suffix}`
    }
    slug = candidate
  }

  const result = db.prepare(`
    INSERT INTO episodes (
      podcast_id, title, slug, episode_number, season_number,
      description, audio_url, audio_filename, audio_size_bytes,
      audio_duration_seconds, image_url, image_filename,
      published_at, status, tags, transcript_path
    ) VALUES (
      @podcast_id, @title, @slug, @episode_number, @season_number,
      @description, @audio_url, @audio_filename, @audio_size_bytes,
      @audio_duration_seconds, @image_url, @image_filename,
      @published_at, @status, @tags, @transcript_path
    )
  `).run({
    podcast_id: podcastId,
    title: body.title,
    slug,
    episode_number: body.episode_number ?? null,
    season_number: body.season_number ?? null,
    description: body.description ?? null,
    audio_url: body.audio_url ?? null,
    audio_filename: body.audio_filename ?? null,
    audio_size_bytes: body.audio_size_bytes ?? null,
    audio_duration_seconds: body.audio_duration_seconds ?? null,
    image_url: body.image_url ?? null,
    image_filename: body.image_filename ?? null,
    published_at: body.published_at ?? null,
    status: body.status ?? 'draft',
    tags: body.tags ?? null,
    transcript_path: body.transcript_path ?? null,
  })

  const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(result.lastInsertRowid) as { status: string }

  // Only kick a rebuild if this episode lands in the published feed.
  if (episode.status === 'published') {
    maybeAutoTrigger(podcastId, 'episode-create')
  }

  event.node.res.statusCode = 201
  return episode
})
