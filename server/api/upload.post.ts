import { defineEventHandler, readMultipartFormData, createError } from 'h3'
import { uploadToSftp } from '../storage/sftp'
import { uploadToS3 } from '../storage/s3'

export default defineEventHandler(async (event) => {
  const parts = await readMultipartFormData(event)

  if (!parts || parts.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'No file uploaded' })
  }

  const filePart = parts.find((p) => p.name === 'file')
  if (!filePart) {
    throw createError({ statusCode: 400, statusMessage: 'Form field "file" not found' })
  }

  const buffer = filePart.data
  const filename = filePart.filename || `upload-${Date.now()}`
  const contentType = filePart.type || 'application/octet-stream'

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
