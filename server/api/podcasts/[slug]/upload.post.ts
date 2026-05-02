import { defineEventHandler, readMultipartFormData, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../utils/auth'
import { loadPodcastStorage } from '../../../utils/storage-config'
import { uploadToSftp } from '../../../storage/sftp'
import { uploadToS3 } from '../../../storage/s3'

/**
 * POST /api/podcasts/[slug]/upload
 *
 * Multipart audio upload routed through the podcast's storage adapter.
 * Storage credentials are stored encrypted in the podcasts row.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)

  const storage = loadPodcastStorage(podcastId)
  if (!storage || (!storage.sftp && !storage.s3)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Storage is not configured for this podcast. Set it up in Settings → Storage.',
    })
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

  const MAX_SIZE = 500 * 1024 * 1024
  if (buffer.length > MAX_SIZE) {
    throw createError({ statusCode: 413, statusMessage: 'File too large. Maximum size is 500 MB.' })
  }

  const ALLOWED_TYPES = [
    'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/x-m4a',
    'audio/aac', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/flac',
  ]
  if (!ALLOWED_TYPES.includes(contentType)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid file type "${contentType}". Only audio files are accepted.`,
    })
  }

  const basename = rawFilename.split(/[/\\]/).pop() || `upload-${Date.now()}`
  const filename = basename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 255)

  let url: string
  try {
    if (storage.adapter === 's3' && storage.s3) {
      url = await uploadToS3(buffer, filename, contentType, storage.s3)
    } else if (storage.adapter === 'sftp' && storage.sftp) {
      url = await uploadToSftp(buffer, filename, storage.sftp)
    } else {
      throw createError({ statusCode: 500, statusMessage: 'Storage configuration mismatch' })
    }
  } catch (err: unknown) {
    throw createError({
      statusCode: 500,
      statusMessage: err instanceof Error ? err.message : 'Upload failed',
    })
  }

  return { url, filename, size: buffer.length, content_type: contentType }
})
