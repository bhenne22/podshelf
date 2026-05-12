import { defineEventHandler, getRouterParam, getQuery, createError } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import getDb from '../../../../db/index'

/**
 * GET /api/podcasts/[slug]/episodes/[id]
 *
 * Optional ?include=chapters,transcript,people — inlines related data into
 * the response so downstream-site incremental sync can collapse
 * "fetch episode + fetch chapters JSON + fetch transcript file + fetch
 * people" into a single round trip. Errors fetching a HTTP-sidecar
 * (chapters, transcript) are non-fatal: the key is omitted and the
 * response carries a `_warnings: [...]` array. The people inline is a
 * local DB join and can't fail mid-response.
 */

const INCLUDE_VALUES = new Set(['chapters', 'transcript', 'people'])

interface EpisodeRow {
  id: number
  podcast_id: number
  chapters_url: string | null
  transcript_path: string | null
  transcript_type: string | null
  [key: string]: unknown
}

function parseInclude(includeParam: string | undefined): Set<string> {
  if (!includeParam) return new Set()
  const requested = includeParam.split(',').map((s) => s.trim()).filter(Boolean)
  for (const v of requested) {
    if (!INCLUDE_VALUES.has(v)) {
      throw createError({
        statusCode: 400,
        statusMessage: `unknown include: ${v}. Allowed: ${[...INCLUDE_VALUES].join(', ')}`,
      })
    }
  }
  return new Set(requested)
}

function resolveSidecarUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  // Some podcasts store transcript_path as a relative path (legacy import
  // shape). Resolve against this Podshelf instance's own SITE_URL so the
  // server fetch lands on the same origin we'd otherwise advertise.
  const base = (process.env.SITE_URL || '').replace(/\/+$/, '')
  if (!base) return pathOrUrl
  return `${base}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`
}

// 10 s budget per sidecar. With AbortController so a slow storage origin
// can't hang the build for minutes.
const SIDECAR_TIMEOUT_MS = 10_000

async function fetchSidecar(url: string): Promise<{ ok: true; body: string; contentType: string | null } | { ok: false; reason: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SIDECAR_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status} ${res.statusText}` }
    const body = await res.text()
    return { ok: true, body, contentType: res.headers.get('content-type') }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: msg }
  } finally {
    clearTimeout(timer)
  }
}

export default defineEventHandler(async (event) => {
  const slugParam = getRouterParam(event, 'slug') as string
  const id = getRouterParam(event, 'id')
  const { podcastId } = requirePodcastAccess(event, slugParam)

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'id is required' })
  }

  const db = getDb()
  const episode = db.prepare('SELECT * FROM episodes WHERE id = ? AND podcast_id = ?')
    .get(id, podcastId) as EpisodeRow | undefined
  if (!episode) {
    throw createError({ statusCode: 404, statusMessage: 'Episode not found' })
  }

  const query = getQuery(event)
  const include = parseInclude(query.include as string | undefined)
  if (include.size === 0) return episode

  const warnings: string[] = []
  const result: EpisodeRow & {
    chapters?: unknown
    transcript?: { type: string | null; content: string }
    people?: unknown
    _warnings?: string[]
  } = { ...episode }

  if (include.has('people')) {
    // Mirrors the projection of GET /episodes/[id]/people. Frozen-at-attach
    // role/group with the person's current name/img/href.
    result.people = db.prepare(`
      SELECT ep.id, ep.episode_id, ep.person_id, ep.role, ep."group" AS "group", ep.position,
             p.name, p.img_url, p.href
      FROM episode_people ep
      JOIN people p ON p.id = ep.person_id
      WHERE ep.episode_id = ?
      ORDER BY ep.position, ep.id
    `).all(episode.id)
  }

  if (include.has('chapters') && episode.chapters_url) {
    const fetched = await fetchSidecar(episode.chapters_url)
    if (fetched.ok) {
      try {
        result.chapters = JSON.parse(fetched.body)
      } catch (err) {
        warnings.push(`chapters: parse error (${err instanceof Error ? err.message : String(err)})`)
      }
    } else {
      warnings.push(`chapters: ${fetched.reason}`)
    }
  }

  if (include.has('transcript') && episode.transcript_path) {
    const url = resolveSidecarUrl(episode.transcript_path)
    const fetched = await fetchSidecar(url)
    if (fetched.ok) {
      result.transcript = {
        type: episode.transcript_type || fetched.contentType,
        content: fetched.body,
      }
    } else {
      warnings.push(`transcript: ${fetched.reason}`)
    }
  }

  if (warnings.length > 0) result._warnings = warnings
  return result
})
