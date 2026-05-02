import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import { loadPodcastStorage, type StorageKind } from '../../../../utils/storage-config'
import { deleteFromSftp } from '../../../../storage/sftp'
import { deleteFromS3 } from '../../../../storage/s3'
import getDb from '../../../../db/index'

/**
 * POST /api/podcasts/[slug]/files/delete
 *
 * Body: { kind, name, force?: boolean }
 *
 * Deletes a file from the podcast's audio or artwork directory.
 * Without force=true, refuses to delete a file referenced by an episode
 * or by the podcast's main image — the response includes a list of
 * referencing entities so the UI can warn.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)
  const body = await readBody(event)
  const kind: StorageKind = body?.kind === 'artwork' ? 'artwork' : 'audio'
  const name = String(body?.name || '').trim()
  const force = !!body?.force

  if (!name) throw createError({ statusCode: 400, statusMessage: 'name is required' })
  if (name.includes('/') || name.includes('\\') || name === '..' || name === '.') {
    throw createError({ statusCode: 400, statusMessage: 'invalid name' })
  }

  const storage = loadPodcastStorage(podcastId)
  if (!storage || (!storage.sftp && !storage.s3)) {
    throw createError({ statusCode: 400, statusMessage: 'Storage not configured' })
  }

  if (!force) {
    const usedBy = referencesFor(podcastId, kind, name)
    if (usedBy.length) {
      throw createError({
        statusCode: 409,
        statusMessage: 'File is referenced; pass force=true to delete anyway',
        data: { usedBy },
      })
    }
  }

  try {
    if (storage.adapter === 'sftp' && storage.sftp) {
      await deleteFromSftp(storage.sftp, kind, name)
    } else if (storage.adapter === 's3' && storage.s3) {
      await deleteFromS3(storage.s3, kind, name)
    }
  } catch (err: unknown) {
    throw createError({ statusCode: 500, statusMessage: err instanceof Error ? err.message : 'Delete failed' })
  }

  return { ok: true }
})

function referencesFor(podcastId: number, kind: StorageKind, name: string): string[] {
  const db = getDb()
  const used: string[] = []

  function lastSegment(url: string | null): string | null {
    if (!url) return null
    try { return decodeURIComponent(url.split('?')[0].split('/').pop() || '') } catch { return null }
  }

  if (kind === 'audio') {
    const rows = db.prepare(`SELECT id, audio_filename, audio_url, title FROM episodes WHERE podcast_id = ?`).all(podcastId) as { id: number; audio_filename: string | null; audio_url: string | null; title: string }[]
    for (const r of rows) {
      const fn = r.audio_filename || lastSegment(r.audio_url)
      if (fn === name) used.push(`Episode #${r.id}: ${r.title}`)
    }
  } else {
    const rows = db.prepare(`SELECT id, image_filename, image_url, title FROM episodes WHERE podcast_id = ?`).all(podcastId) as { id: number; image_filename: string | null; image_url: string | null; title: string }[]
    for (const r of rows) {
      const fn = r.image_filename || lastSegment(r.image_url)
      if (fn === name) used.push(`Episode #${r.id}: ${r.title}`)
    }
    const podcast = db.prepare(`SELECT image_url FROM podcasts WHERE id = ?`).get(podcastId) as { image_url: string | null } | undefined
    if (lastSegment(podcast?.image_url || null) === name) used.push('Podcast main artwork')
  }
  return used
}
