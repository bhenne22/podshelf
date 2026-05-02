import { defineEventHandler, readBody, createError } from 'h3'
import { requireAdmin } from '../../utils/auth'
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

/**
 * POST /api/podcasts
 *
 * Admin-only. Creates a new podcast and adds the creating admin as a member.
 * Body: { slug?, title, description?, ... }
 */
export default defineEventHandler(async (event) => {
  const user = requireAdmin(event)
  const body = await readBody(event)

  if (!body?.title) {
    throw createError({ statusCode: 400, statusMessage: 'title is required' })
  }

  const db = getDb()

  let slug = body.slug ? slugify(String(body.slug)) : slugify(String(body.title))
  if (!slug) {
    throw createError({ statusCode: 400, statusMessage: 'unable to derive a slug from title' })
  }

  if (db.prepare('SELECT 1 FROM podcasts WHERE slug = ?').get(slug)) {
    throw createError({ statusCode: 409, statusMessage: `Podcast slug "${slug}" already exists` })
  }

  const insert = db.transaction((row: Record<string, unknown>) => {
    const result = db.prepare(`
      INSERT INTO podcasts (
        slug, title, description, author, email, image_url,
        language, copyright, category, explicit, website,
        audio_tracking_prefix, storage_adapter
      ) VALUES (
        @slug, @title, @description, @author, @email, @image_url,
        @language, @copyright, @category, @explicit, @website,
        @audio_tracking_prefix, @storage_adapter
      )
    `).run(row)

    db.prepare(`
      INSERT INTO podcast_users (podcast_id, user_id) VALUES (?, ?)
    `).run(result.lastInsertRowid, user.id)

    return result.lastInsertRowid
  })

  const id = insert({
    slug,
    title: body.title,
    description: body.description ?? null,
    author: body.author ?? null,
    email: body.email ?? null,
    image_url: body.image_url ?? null,
    language: body.language ?? 'en',
    copyright: body.copyright ?? null,
    category: body.category ?? 'Society & Culture',
    explicit: body.explicit ?? 'false',
    website: body.website ?? null,
    audio_tracking_prefix: body.audio_tracking_prefix ?? null,
    storage_adapter: body.storage_adapter ?? 'sftp',
  })

  event.node.res.statusCode = 201
  return db.prepare('SELECT * FROM podcasts WHERE id = ?').get(id)
})
