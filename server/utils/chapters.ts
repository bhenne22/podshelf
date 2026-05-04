import { createError } from 'h3'
import { loadPodcastStorage } from './storage-config'
import { uploadToSftp } from '../storage/sftp'
import { uploadToS3 } from '../storage/s3'

export interface Chapter {
  startTime: number
  title: string
  url?: string
  img?: string
}

/**
 * Parses a textarea-style chapter list. Each line is "MM:SS Title" or
 * "HH:MM:SS Title". Blank lines and lines starting with '#' are ignored.
 * URLs and image URLs are optional, separated by tabs or " | " — kept
 * minimal because the form is a single textarea, not a structured editor.
 *
 *   00:00 Intro
 *   05:30 Topic one | https://example.com/topic-one
 *   12:15 Guest interview
 */
export function parseChapterLines(text: string): Chapter[] {
  const out: Chapter[] = []
  const lines = text.split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue

    // Split off optional " | url" suffix
    const pipeIdx = line.indexOf(' | ')
    const main = pipeIdx >= 0 ? line.slice(0, pipeIdx).trim() : line
    const url = pipeIdx >= 0 ? line.slice(pipeIdx + 3).trim() : ''

    const m = main.match(/^(\d{1,2}(?::\d{2}){1,2})\s+(.+)$/)
    if (!m) continue

    const parts = m[1].split(':').map((p) => parseInt(p, 10))
    if (parts.some((p) => !Number.isFinite(p))) continue
    let seconds = 0
    for (const p of parts) seconds = seconds * 60 + p

    const chapter: Chapter = { startTime: seconds, title: m[2].trim() }
    if (url) chapter.url = url
    out.push(chapter)
  }
  return out
}

export function chaptersToJson(chapters: Chapter[]): string {
  // Podcasting 2.0 jsonChapters spec.
  return JSON.stringify({
    version: '1.2.0',
    chapters,
  }, null, 2)
}

/**
 * Render and upload the chapters JSON to the podcast's audio storage
 * directory (sidecar to the MP3). Returns the public URL.
 */
export async function uploadChaptersJson(
  podcastId: number,
  filename: string,
  chapters: Chapter[],
): Promise<string> {
  const storage = loadPodcastStorage(podcastId)
  if (!storage || (!storage.sftp && !storage.s3)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Storage is not configured for this podcast. Set it up in Settings → Storage.',
    })
  }

  const json = chaptersToJson(chapters)
  const buffer = Buffer.from(json, 'utf8')
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 255)

  if (storage.adapter === 's3' && storage.s3) {
    return uploadToS3(buffer, safeName, 'application/json+chapters', storage.s3, 'audio')
  }
  if (storage.adapter === 'sftp' && storage.sftp) {
    return uploadToSftp(buffer, safeName, storage.sftp, 'audio')
  }
  throw createError({ statusCode: 500, statusMessage: 'Storage configuration mismatch' })
}
