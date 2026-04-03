import { defineEventHandler, readBody, createError } from 'h3'
import { requireAuth } from '../../utils/auth'
import getDb from '../../db/index'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export default defineEventHandler(async (event) => {
  requireAuth(event)

  const db = getDb()
  const body = await readBody(event)

  if (!body?.title) {
    throw createError({ statusCode: 400, statusMessage: 'title is required' })
  }

  // Auto-generate slug from title if not provided
  let slug = body.slug ? slugify(body.slug) : slugify(body.title)

  // Ensure slug uniqueness — append a number if needed
  const existing = db.prepare('SELECT slug FROM episodes WHERE slug = ?').get(slug)
  if (existing) {
    let suffix = 2
    let candidate = `${slug}-${suffix}`
    while (db.prepare('SELECT slug FROM episodes WHERE slug = ?').get(candidate)) {
      suffix++
      candidate = `${slug}-${suffix}`
    }
    slug = candidate
  }

  const stmt = db.prepare(`
    INSERT INTO episodes (
      title, slug, episode_number, season_number,
      description, audio_url, audio_filename, audio_size_bytes,
      audio_duration_seconds, published_at, status, tags, transcript_path
    ) VALUES (
      @title, @slug, @episode_number, @season_number,
      @description, @audio_url, @audio_filename, @audio_size_bytes,
      @audio_duration_seconds, @published_at, @status, @tags, @transcript_path
    )
  `)

  const result = stmt.run({
    title: body.title,
    slug,
    episode_number: body.episode_number ?? null,
    season_number: body.season_number ?? null,
    description: body.description ?? null,
    audio_url: body.audio_url ?? null,
    audio_filename: body.audio_filename ?? null,
    audio_size_bytes: body.audio_size_bytes ?? null,
    audio_duration_seconds: body.audio_duration_seconds ?? null,
    published_at: body.published_at ?? null,
    status: body.status ?? 'draft',
    tags: body.tags ?? null,
    transcript_path: body.transcript_path ?? null,
  })

  const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(result.lastInsertRowid)

  event.node.res.statusCode = 201
  return episode
})
