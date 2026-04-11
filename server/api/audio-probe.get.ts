import { defineEventHandler, getQuery, createError } from 'h3'
import { requireAuth } from '../utils/auth'

/**
 * GET /api/audio-probe?url=<audio_url>
 *
 * Sends a HEAD request to the given audio URL and returns the file size
 * from the Content-Length header.
 */
export default defineEventHandler(async (event) => {
  requireAuth(event)

  const { url } = getQuery(event) as { url?: string }

  if (!url || typeof url !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'url query parameter is required' })
  }

  try {
    new URL(url)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'url must be a valid URL' })
  }

  try {
    const response = await fetch(url, { method: 'HEAD' })

    if (!response.ok) {
      throw createError({
        statusCode: 502,
        statusMessage: `Remote server returned ${response.status}`,
      })
    }

    const contentLength = response.headers.get('content-length')
    const contentType = response.headers.get('content-type')

    return {
      size: contentLength ? Number(contentLength) : null,
      contentType: contentType || null,
    }
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err) throw err
    throw createError({
      statusCode: 502,
      statusMessage: err instanceof Error ? err.message : 'Failed to probe audio URL',
    })
  }
})
