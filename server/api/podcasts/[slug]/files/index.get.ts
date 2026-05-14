import { defineEventHandler, getRouterParam, getQuery, createError } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import { loadPodcastStorage, type StorageKind } from '../../../../utils/storage-config'
import { listSftpDirectory } from '../../../../storage/sftp'
import { listS3Directory } from '../../../../storage/s3'
import getDb from '../../../../db/index'

interface FileEntry {
  name: string
  size: number
  modifiedAt: string | null
  url: string
  inUse: boolean
  usedBy: string[]
}

/**
 * GET /api/podcasts/[slug]/files?kind=audio|artwork
 *
 * Lists files in the podcast's audio or artwork directory and marks
 * each one as in-use if it's referenced by an episode or by the
 * podcast's main image.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)
  const query = getQuery(event)
  const kind: StorageKind = query.kind === 'artwork' ? 'artwork' : 'audio'

  const storage = loadPodcastStorage(podcastId)
  if (!storage || (!storage.sftp && !storage.s3)) {
    throw createError({ statusCode: 400, statusMessage: 'Storage not configured' })
  }

  let entries: { name: string; size: number; modifiedAt: string | null }[] = []
  let publicUrlBase = ''
  try {
    if (storage.adapter === 'sftp' && storage.sftp) {
      const result = await listSftpDirectory(storage.sftp, kind)
      publicUrlBase = result.publicUrlBase
      entries = result.entries
        .filter((e) => e.type === 'file')
        .map((e) => ({
          name: e.name,
          size: e.size,
          modifiedAt: e.modifiedAt ? new Date(e.modifiedAt).toISOString() : null,
        }))
    } else if (storage.adapter === 's3' && storage.s3) {
      const result = await listS3Directory(storage.s3, kind)
      publicUrlBase = result.publicUrlBase
      entries = result.entries
        .filter((e) => e.key && !e.key.endsWith('/'))
        .map((e) => ({ name: e.key, size: e.size, modifiedAt: e.modifiedAt }))
    }
  } catch (err: unknown) {
    throw createError({ statusCode: 500, statusMessage: err instanceof Error ? err.message : 'Failed to list directory' })
  }

  const db = getDb()

  // Reference look-ups
  const audioByFilename = new Set<string>()
  const imageByFilename = new Set<string>()
  const audioRefRows = db.prepare(`SELECT id, audio_filename, audio_url, title FROM episodes WHERE podcast_id = ?`).all(podcastId) as { id: number; audio_filename: string | null; audio_url: string | null; title: string }[]
  const imageRefRows = db.prepare(`SELECT id, image_filename, image_url, title FROM episodes WHERE podcast_id = ?`).all(podcastId) as { id: number; image_filename: string | null; image_url: string | null; title: string }[]
  // Sidecars (transcripts + chapters JSON) live in the audio directory, so
  // we also look up which episodes reference them by URL last-segment.
  const sidecarRefRows = db.prepare(`SELECT id, transcript_path, chapters_url, title FROM episodes WHERE podcast_id = ?`).all(podcastId) as { id: number; transcript_path: string | null; chapters_url: string | null; title: string }[]
  const podcastImageRow = db.prepare(`SELECT image_url FROM podcasts WHERE id = ?`).get(podcastId) as { image_url: string | null } | undefined

  function lastSegment(url: string | null): string | null {
    if (!url) return null
    try {
      return decodeURIComponent(url.split('?')[0].split('/').pop() || '')
    } catch {
      return null
    }
  }

  // Map: filename -> labels of references (for the 'usedBy' list)
  const audioUses = new Map<string, string[]>()
  for (const r of audioRefRows) {
    const name = r.audio_filename || lastSegment(r.audio_url)
    if (!name) continue
    audioByFilename.add(name)
    if (!audioUses.has(name)) audioUses.set(name, [])
    audioUses.get(name)!.push(`Episode #${r.id}: ${r.title}`)
  }
  const imageUses = new Map<string, string[]>()
  for (const r of imageRefRows) {
    const name = r.image_filename || lastSegment(r.image_url)
    if (!name) continue
    imageByFilename.add(name)
    if (!imageUses.has(name)) imageUses.set(name, [])
    imageUses.get(name)!.push(`Episode #${r.id}: ${r.title}`)
  }
  const podcastImageName = lastSegment(podcastImageRow?.image_url || null)

  const transcriptUses = new Map<string, string[]>()
  const chaptersUses = new Map<string, string[]>()
  for (const r of sidecarRefRows) {
    const tName = lastSegment(r.transcript_path)
    if (tName) {
      if (!transcriptUses.has(tName)) transcriptUses.set(tName, [])
      transcriptUses.get(tName)!.push(`Transcript for #${r.id}: ${r.title}`)
    }
    const cName = lastSegment(r.chapters_url)
    if (cName) {
      if (!chaptersUses.has(cName)) chaptersUses.set(cName, [])
      chaptersUses.get(cName)!.push(`Chapters for #${r.id}: ${r.title}`)
    }
  }

  const base = publicUrlBase.replace(/\/$/, '')
  const result: FileEntry[] = entries.map((e) => {
    const usedBy: string[] = []
    if (kind === 'audio') {
      if (audioByFilename.has(e.name)) usedBy.push(...(audioUses.get(e.name) || []))
      if (transcriptUses.has(e.name)) usedBy.push(...(transcriptUses.get(e.name) || []))
      if (chaptersUses.has(e.name)) usedBy.push(...(chaptersUses.get(e.name) || []))
    } else {
      if (imageByFilename.has(e.name)) usedBy.push(...(imageUses.get(e.name) || []))
      if (podcastImageName === e.name) usedBy.push('Podcast main artwork')
    }
    return {
      name: e.name,
      size: e.size,
      modifiedAt: e.modifiedAt,
      url: `${base}/${e.name}`,
      inUse: usedBy.length > 0,
      usedBy,
    }
  })

  return { kind, publicUrlBase, files: result }
})
