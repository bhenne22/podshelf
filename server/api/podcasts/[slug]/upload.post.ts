import { defineEventHandler, readMultipartFormData, getRouterParam, getQuery, createError } from 'h3'
import { requirePodcastAccess } from '../../../utils/auth'
import { loadPodcastStorage } from '../../../utils/storage-config'
import { isMigrationActive } from '../../../utils/storage-migration'
import { uploadToSftp } from '../../../storage/sftp'
import { uploadToS3 } from '../../../storage/s3'

const AUDIO_TYPES = [
  'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/x-m4a',
  'audio/aac', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/flac',
]
const IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']

// Browsers report wildly inconsistent MIMEs for transcript files: .srt is often
// 'application/octet-stream', .vtt sometimes 'text/plain'. Accept the common
// content-type set + fall back to extension matching for the rest.
const TRANSCRIPT_TYPES = [
  'text/html', 'text/plain', 'text/vtt',
  'application/srt', 'application/x-subrip',
  'application/json',
  'application/octet-stream',
]
const TRANSCRIPT_EXTENSIONS = ['html', 'htm', 'txt', 'srt', 'vtt', 'json']

const CHAPTERS_TYPES = ['application/json', 'application/octet-stream']
const CHAPTERS_EXTENSIONS = ['json']

const MAX_SIZE_AUDIO = 500 * 1024 * 1024
const MAX_SIZE_IMAGE = 25 * 1024 * 1024
const MAX_SIZE_TEXT = 10 * 1024 * 1024
const MAX_SIZE_CHAPTERS = 2 * 1024 * 1024

type UploadKind = 'audio' | 'artwork' | 'transcript' | 'chapters'

function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : ''
}

/**
 * POST /api/podcasts/[slug]/upload?kind=audio|artwork|transcript|chapters
 *
 * Multipart upload routed through the podcast's storage adapter.
 * Storage credentials are stored encrypted in the podcasts row.
 *
 * Transcript and chapters files land in the same directory as audio
 * (sidecar files next to the MP3) — Podshelf doesn't host listener-facing
 * content, so all per-episode artifacts live with the episode audio.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)

  const query = getQuery(event)
  const rawKind = String(query.kind || 'audio')
  const kind: UploadKind = (
    rawKind === 'artwork' || rawKind === 'transcript' || rawKind === 'chapters'
  ) ? rawKind : 'audio'
  // Physical storage directory: artwork → artwork dir, everything else → audio dir.
  const storageKind: 'audio' | 'artwork' = kind === 'artwork' ? 'artwork' : 'audio'

  if (isMigrationActive(podcastId)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'A storage migration is in progress for this podcast. Wait until it finishes before uploading new files.',
    })
  }

  const storage = loadPodcastStorage(podcastId)
  if (!storage || (!storage.sftp && !storage.s3)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Storage is not configured for this podcast. Set it up in Settings → Storage.',
    })
  }

  if (kind === 'artwork') {
    if (storage.adapter === 'sftp' && (!storage.sftp?.artworkRemoteDir || !storage.sftp?.artworkPublicUrlBase)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Artwork directory is not configured. Set artwork remote directory and public URL base in Storage settings.',
      })
    }
    if (storage.adapter === 's3' && !storage.s3?.artworkPublicUrlBase && !storage.s3?.artworkPrefix) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Artwork S3 settings are not configured. Set artwork prefix and/or public URL base in Storage settings.',
      })
    }
  }

  const parts = await readMultipartFormData(event)
  if (!parts || parts.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'No file uploaded' })
  }

  const filePart = parts.find((p) => p.name === 'file')
  if (!filePart) {
    throw createError({ statusCode: 400, statusMessage: 'Form field "file" not found' })
  }

  const buffer = filePart.data
  const rawFilename = filePart.filename || `upload-${Date.now()}`
  const contentType = filePart.type || 'application/octet-stream'

  const maxSize =
    kind === 'artwork' ? MAX_SIZE_IMAGE :
    kind === 'transcript' ? MAX_SIZE_TEXT :
    kind === 'chapters' ? MAX_SIZE_CHAPTERS :
    MAX_SIZE_AUDIO

  if (buffer.length > maxSize) {
    const mb = Math.round(maxSize / (1024 * 1024))
    throw createError({ statusCode: 413, statusMessage: `File too large. Maximum size is ${mb} MB.` })
  }

  const ext = extOf(rawFilename)
  const acceptedByMime =
    kind === 'artwork' ? IMAGE_TYPES.includes(contentType) :
    kind === 'transcript' ? TRANSCRIPT_TYPES.includes(contentType) :
    kind === 'chapters' ? CHAPTERS_TYPES.includes(contentType) :
    AUDIO_TYPES.includes(contentType)
  const acceptedByExt =
    kind === 'transcript' ? TRANSCRIPT_EXTENSIONS.includes(ext) :
    kind === 'chapters' ? CHAPTERS_EXTENSIONS.includes(ext) :
    false

  if (!acceptedByMime && !acceptedByExt) {
    const friendly =
      kind === 'artwork' ? 'image (JPEG, PNG, or WebP)' :
      kind === 'transcript' ? 'transcript (HTML, TXT, SRT, VTT, or JSON)' :
      kind === 'chapters' ? 'chapters JSON' :
      'audio'
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid file type "${contentType}". Expected a ${friendly} file.`,
    })
  }

  const basename = rawFilename.split(/[/\\]/).pop() || `upload-${Date.now()}`
  const filename = basename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 255)

  // Normalize the stored content-type so the response carries something
  // usable by the client form (e.g. for transcript_type). For SRT files
  // browsers often send octet-stream; map ext → standard type when they do.
  let storedContentType = contentType
  if (kind === 'transcript' && contentType === 'application/octet-stream') {
    if (ext === 'srt') storedContentType = 'application/srt'
    else if (ext === 'vtt') storedContentType = 'text/vtt'
    else if (ext === 'json') storedContentType = 'application/json'
    else if (ext === 'html' || ext === 'htm') storedContentType = 'text/html'
    else if (ext === 'txt') storedContentType = 'text/plain'
  }
  if (kind === 'chapters') storedContentType = 'application/json+chapters'

  let url: string
  try {
    if (storage.adapter === 's3' && storage.s3) {
      url = await uploadToS3(buffer, filename, storedContentType, storage.s3, storageKind)
    } else if (storage.adapter === 'sftp' && storage.sftp) {
      url = await uploadToSftp(buffer, filename, storage.sftp, storageKind)
    } else {
      throw createError({ statusCode: 500, statusMessage: 'Storage configuration mismatch' })
    }
  } catch (err: unknown) {
    throw createError({
      statusCode: 500,
      statusMessage: err instanceof Error ? err.message : 'Upload failed',
    })
  }

  return { url, filename, size: buffer.length, content_type: storedContentType, kind }
})
