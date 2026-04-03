import { defineEventHandler, readMultipartFormData, createError } from 'h3'
import { requireAuth } from '../utils/auth'
import { uploadToSftp } from '../storage/sftp'
import { uploadToS3 } from '../storage/s3'

export default defineEventHandler(async (event) => {
  requireAuth(event)

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

  // Validate file size (500 MB limit)
  const MAX_SIZE = 500 * 1024 * 1024
  if (buffer.length > MAX_SIZE) {
    throw createError({ statusCode: 413, statusMessage: 'File too large. Maximum size is 500 MB.' })
  }

  // Validate content type — audio files only
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

  // Sanitize filename: strip path components, restrict to safe characters
  const basename = rawFilename.split(/[/\\]/).pop() || `upload-${Date.now()}`
  const filename = basename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 255)

  const adapter = process.env.STORAGE_ADAPTER || 'sftp'

  let url: string

  if (adapter === 's3') {
    url = await uploadToS3(buffer, filename, contentType)
  } else if (adapter === 'sftp') {
    url = await uploadToSftp(buffer, filename)
  } else {
    throw createError({
      statusCode: 500,
      statusMessage: `Unknown STORAGE_ADAPTER: "${adapter}". Use "sftp" or "s3".`,
    })
  }

  return {
    url,
    filename,
    size: buffer.length,
    content_type: contentType,
  }
})
