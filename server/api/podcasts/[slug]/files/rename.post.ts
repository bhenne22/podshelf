import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import { loadPodcastStorage, type StorageKind } from '../../../../utils/storage-config'
import { renameInSftp } from '../../../../storage/sftp'
import { renameInS3 } from '../../../../storage/s3'
import getDb from '../../../../db/index'

/**
 * POST /api/podcasts/[slug]/files/rename
 *
 * Body: { kind, fromName, toName, updateReferences?: boolean }
 *
 * Renames a file in the podcast's audio or artwork directory.
 * If updateReferences is true, episode/podcast rows that reference the
 * original filename are updated to the new URL/filename in the same
 * transaction. Without it, the rename happens but references are left
 * pointing to the gone file.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)
  const body = await readBody(event)
  const kind: StorageKind = body?.kind === 'artwork' ? 'artwork' : 'audio'
  const fromName = String(body?.fromName || '').trim()
  const toName = String(body?.toName || '').trim()
  const updateReferences = !!body?.updateReferences

  if (!fromName || !toName) throw createError({ statusCode: 400, statusMessage: 'fromName and toName required' })
  for (const n of [fromName, toName]) {
    if (n.includes('/') || n.includes('\\') || n === '..' || n === '.') {
      throw createError({ statusCode: 400, statusMessage: 'invalid filename' })
    }
  }
  if (fromName === toName) {
    throw createError({ statusCode: 400, statusMessage: 'fromName and toName are identical' })
  }
  // sanitise the destination — same rules the upload endpoint uses
  const safeTo = toName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 255)
  if (safeTo !== toName) {
    throw createError({ statusCode: 400, statusMessage: 'toName contains characters that would be rewritten on upload; rename to a safe name first' })
  }

  const storage = loadPodcastStorage(podcastId)
  if (!storage || (!storage.sftp && !storage.s3)) {
    throw createError({ statusCode: 400, statusMessage: 'Storage not configured' })
  }

  let newUrl: string
  try {
    if (storage.adapter === 'sftp' && storage.sftp) {
      newUrl = await renameInSftp(storage.sftp, kind, fromName, toName)
    } else if (storage.adapter === 's3' && storage.s3) {
      newUrl = await renameInS3(storage.s3, kind, fromName, toName)
    } else {
      throw createError({ statusCode: 500, statusMessage: 'Storage adapter mismatch' })
    }
  } catch (err: unknown) {
    throw createError({ statusCode: 500, statusMessage: err instanceof Error ? err.message : 'Rename failed' })
  }

  let updatedEpisodes = 0
  let updatedPodcast = false
  if (updateReferences) {
    const db = getDb()
    if (kind === 'audio') {
      const result = db.prepare(`
        UPDATE episodes
        SET audio_url = ?, audio_filename = ?, updated_at = datetime('now')
        WHERE podcast_id = ? AND audio_filename = ?
      `).run(newUrl, toName, podcastId, fromName)
      updatedEpisodes = result.changes
    } else {
      const result = db.prepare(`
        UPDATE episodes
        SET image_url = ?, image_filename = ?, updated_at = datetime('now')
        WHERE podcast_id = ? AND image_filename = ?
      `).run(newUrl, toName, podcastId, fromName)
      updatedEpisodes = result.changes

      // Podcast main artwork — match by URL last-segment since podcasts table
      // doesn't store a filename column.
      const row = db.prepare('SELECT image_url FROM podcasts WHERE id = ?').get(podcastId) as { image_url: string | null } | undefined
      const lastSeg = (() => {
        if (!row?.image_url) return null
        try { return decodeURIComponent(row.image_url.split('?')[0].split('/').pop() || '') } catch { return null }
      })()
      if (lastSeg === fromName) {
        db.prepare(`UPDATE podcasts SET image_url = ?, updated_at = datetime('now') WHERE id = ?`).run(newUrl, podcastId)
        updatedPodcast = true
      }
    }
  }

  return { ok: true, url: newUrl, name: toName, updatedEpisodes, updatedPodcast }
})
