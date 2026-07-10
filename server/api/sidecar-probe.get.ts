import { defineEventHandler, getQuery, createError } from 'h3'
import { requireWriteAuth } from '../utils/auth'
import { assertPublicHttpUrl } from '../utils/ssrf'
import { validateTranscript, validateChaptersJson, formatHms } from '../utils/sidecar'

/**
 * GET /api/sidecar-probe?url=<sidecar_url>&kind=transcript|chapters
 *
 * Fetches a transcript or chapters JSON sidecar, validates the format, and
 * returns a content summary the episode-edit UI can render inline.
 *
 * Always also reports `reachable`, `size`, `contentType` so the UI can show
 * a useful state when the format isn't one we can parse (e.g., HTML
 * transcript) — the reachability check is the first-line guard against
 * broken-link regressions like the 2026-05-12 rsync-delete incident.
 */

const SIZE_LIMIT_BYTES = 10 * 1024 * 1024 // 10 MB
const FETCH_TIMEOUT_MS = 15_000

export default defineEventHandler(async (event) => {
  requireWriteAuth(event)

  const { url, kind } = getQuery(event) as { url?: string; kind?: string }

  if (!url || typeof url !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'url query parameter is required' })
  }
  if (kind !== 'transcript' && kind !== 'chapters') {
    throw createError({ statusCode: 400, statusMessage: 'kind must be "transcript" or "chapters"' })
  }
  await assertPublicHttpUrl(url)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(url, { signal: controller.signal })
  } catch (err: unknown) {
    clearTimeout(timeoutId)
    const msg = err instanceof Error ? err.message : 'fetch failed'
    return {
      reachable: false,
      size: null as number | null,
      contentType: null as string | null,
      ok: false,
      summary: null,
      errors: [`Could not fetch URL: ${msg}`],
    }
  }
  clearTimeout(timeoutId)

  if (!res.ok) {
    return {
      reachable: false,
      size: null,
      contentType: res.headers.get('content-type'),
      ok: false,
      summary: null,
      errors: [`Remote server returned HTTP ${res.status}`],
    }
  }

  const contentType = res.headers.get('content-type') || ''
  const contentLengthHeader = res.headers.get('content-length')
  const declaredSize = contentLengthHeader ? Number(contentLengthHeader) : null
  if (declaredSize && declaredSize > SIZE_LIMIT_BYTES) {
    return {
      reachable: true,
      size: declaredSize,
      contentType,
      ok: false,
      summary: null,
      errors: [`File is ${(declaredSize / 1024 / 1024).toFixed(1)} MB — exceeds ${SIZE_LIMIT_BYTES / 1024 / 1024} MB probe limit.`],
    }
  }

  const text = await res.text()
  if (text.length > SIZE_LIMIT_BYTES) {
    return {
      reachable: true,
      size: text.length,
      contentType,
      ok: false,
      summary: null,
      errors: [`File is ${(text.length / 1024 / 1024).toFixed(1)} MB after download — exceeds probe limit.`],
    }
  }

  const size = declaredSize ?? text.length

  if (kind === 'transcript') {
    const result = validateTranscript(text, contentType, url)
    const summary = result.summary
      ? {
          ...result.summary,
          durationFormatted: formatHms(result.summary.durationSeconds),
        }
      : null
    return {
      reachable: true,
      size,
      contentType,
      ok: result.ok,
      summary,
      errors: result.errors,
    }
  }

  // chapters
  const result = validateChaptersJson(text)
  const summary = result.summary
    ? {
        ...result.summary,
        lastStartFormatted: formatHms(result.summary.lastStartSeconds),
      }
    : null
  return {
    reachable: true,
    size,
    contentType,
    ok: result.ok,
    summary,
    errors: result.errors,
  }
})
