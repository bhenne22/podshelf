import { defineEventHandler, getRouterParam, getQuery, createError, setHeader } from 'h3'
import { requirePodcastAccess } from '../../../../../utils/auth'
import getDb from '../../../../../db/index'

/**
 * GET /api/podcasts/[slug]/episodes/[id]/asset?kind=chapters|transcript
 *
 * Server-side proxy that streams an episode's chapters JSON or transcript
 * file back to the caller, bypassing CORS on the storage host. The URL is
 * read from the trusted `episodes` row — the caller can't supply an arbitrary
 * URL, so this isn't an SSRF surface.
 */

const MAX_BYTES = 5 * 1024 * 1024 // 5 MB — chapters/transcript files are tiny in practice

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const idParam = getRouterParam(event, 'id')
  const id = Number(idParam)
  const { podcastId } = requirePodcastAccess(event, slug)

  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'episode id required' })
  }

  const kind = String((getQuery(event).kind as string | undefined) ?? '')
  if (kind !== 'chapters' && kind !== 'transcript') {
    throw createError({ statusCode: 400, statusMessage: 'kind must be "chapters" or "transcript"' })
  }

  const db = getDb()
  const ep = db.prepare(
    'SELECT chapters_url, transcript_path, transcript_type FROM episodes WHERE id = ? AND podcast_id = ?'
  ).get(id, podcastId) as
    | { chapters_url: string | null; transcript_path: string | null; transcript_type: string | null }
    | undefined

  if (!ep) {
    throw createError({ statusCode: 404, statusMessage: 'Episode not found' })
  }

  const url = kind === 'chapters' ? ep.chapters_url : ep.transcript_path
  if (!url) {
    throw createError({ statusCode: 404, statusMessage: `Episode has no ${kind}` })
  }

  let response: Response
  try {
    response = await fetch(url)
  } catch (err: unknown) {
    throw createError({
      statusCode: 502,
      statusMessage: `Failed to fetch ${kind}: ${err instanceof Error ? err.message : 'unknown error'}`,
    })
  }

  if (!response.ok) {
    throw createError({
      statusCode: 502,
      statusMessage: `Remote server returned ${response.status} for ${kind}`,
    })
  }

  const declaredLength = Number(response.headers.get('content-length') ?? '0')
  if (declaredLength > MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: `${kind} exceeds ${MAX_BYTES} bytes` })
  }

  const buf = Buffer.from(await response.arrayBuffer())
  if (buf.byteLength > MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: `${kind} exceeds ${MAX_BYTES} bytes` })
  }

  // Pass through the upstream content-type when present; otherwise fall back to
  // the saved transcript_type (chapters always JSON).
  const upstreamType = response.headers.get('content-type')
  const fallbackType = kind === 'chapters'
    ? 'application/json'
    : (ep.transcript_type || 'text/plain')
  setHeader(event, 'content-type', upstreamType || fallbackType)

  // Allow the browser to cache briefly within the session — these files don't
  // change often and the preview page can re-poll on revisit anyway.
  setHeader(event, 'cache-control', 'private, max-age=60')

  return buf
})
