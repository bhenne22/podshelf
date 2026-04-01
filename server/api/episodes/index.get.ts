import { defineEventHandler, getQuery } from 'h3'
import getDb from '../../db/index'

export default defineEventHandler((event) => {
  const db = getDb()
  const query = getQuery(event)

  let sql = `
    SELECT
      id, title, slug, episode_number, season_number,
      description, audio_url, audio_filename, audio_size_bytes,
      audio_duration_seconds, published_at, status, tags,
      transcript_path, created_at, updated_at
    FROM episodes
  `
  const params: string[] = []

  if (query.status) {
    sql += ' WHERE status = ?'
    params.push(query.status as string)
  }

  // Order: published_at DESC (NULLs last), then created_at DESC
  sql += `
    ORDER BY
      CASE WHEN published_at IS NULL THEN 1 ELSE 0 END,
      published_at DESC,
      created_at DESC
  `

  const episodes = db.prepare(sql).all(...params)

  return episodes
})
