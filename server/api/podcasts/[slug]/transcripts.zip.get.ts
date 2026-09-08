import { defineEventHandler, getRouterParam, getQuery, setHeader, createError } from 'h3'
import { requirePodcastAccess } from '../../../utils/auth'
import { buildZip, safeEntryName, type ZipEntry } from '../../../utils/zip'
import getDb from '../../../db/index'

/**
 * GET /api/podcasts/[slug]/transcripts.zip
 *
 * Every transcript (and by default every chapter file) for a podcast, in one
 * download. Membership required — same access as the rest of the podcast.
 *
 * This exists because the files were only reachable one URL at a time. A host
 * who wants their own transcripts — out of curiosity, to search them, or to
 * take them somewhere else — should not have to click through 150 episodes,
 * and `export.json` only carries the URLs, not the contents.
 *
 * Query params:
 *   include   comma-separated: transcripts, chapters (default: both)
 *   status    draft|scheduled|published — default: everything the podcast has
 *
 * The files live on the podcast's own storage (DreamHost for this network) and
 * are publicly readable, so they're fetched over HTTP rather than through the
 * storage adapter — no credentials needed and it works for S3-backed podcasts
 * too.
 */

// Sized for the largest show (Subtle Interference, ~22 MB of transcripts).
// Podshelf runs on a 1 GB box and the archive is assembled in memory, so this
// refuses rather than pushing the box into swap.
const MAX_TOTAL_BYTES = 200 * 1024 * 1024
const FETCH_CONCURRENCY = 6
const FETCH_TIMEOUT_MS = 30_000

interface Row {
  id: number
  title: string | null
  slug: string | null
  episode_number: number | null
  season_number: number | null
  published_at: string | null
  transcript_path: string | null
  chapters_url: string | null
}

async function fetchFile(url: string): Promise<Buffer | null> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { 'User-Agent': 'podshelf/1.0 (transcript export)' },
    })
    if (!res.ok) return null
    return Buffer.from(await res.arrayBuffer())
  } catch {
    // A missing or unreachable sidecar shouldn't fail the whole download —
    // the caller reports what was skipped instead.
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Run tasks with bounded concurrency; 150 sequential fetches is needlessly slow. */
async function pooled<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]
      await fn(item)
    }
  })
  await Promise.all(workers)
}

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)
  const query = getQuery(event)

  const include = String(query.include || 'transcripts,chapters')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  const wantTranscripts = include.includes('transcripts')
  const wantChapters = include.includes('chapters')
  if (!wantTranscripts && !wantChapters) {
    throw createError({ statusCode: 400, statusMessage: 'include must name transcripts and/or chapters' })
  }

  const db = getDb()
  let sql = `
    SELECT id, title, slug, episode_number, season_number, published_at,
           transcript_path, chapters_url
    FROM episodes
    WHERE podcast_id = ?
  `
  const params: (string | number)[] = [podcastId]
  if (query.status) {
    const status = String(query.status)
    if (!['draft', 'scheduled', 'published'].includes(status)) {
      throw createError({ statusCode: 400, statusMessage: 'status must be draft, scheduled or published' })
    }
    sql += ' AND status = ?'
    params.push(status)
  }
  sql += ' ORDER BY COALESCE(published_at, created_at) ASC, id ASC'
  const rows = db.prepare(sql).all(...params) as Row[]

  // Collect the work first so the archive can be ordered and capped before
  // anything is fetched.
  interface Job { url: string; name: string }
  const jobs: Job[] = []
  for (const r of rows) {
    // A stable, sortable prefix keeps episodes in order in the extracted
    // folder regardless of how the viewer sorts.
    const base = safeEntryName(r.slug || r.title || `episode-${r.id}`, `episode-${r.id}`)
    const prefix = `${String(r.id).padStart(5, '0')}-${base}`
    if (wantTranscripts && r.transcript_path?.trim()) {
      const ext = r.transcript_path.split('?')[0].endsWith('.vtt') ? 'vtt' : 'srt'
      jobs.push({ url: r.transcript_path.trim(), name: `transcripts/${prefix}.${ext}` })
    }
    if (wantChapters && r.chapters_url?.trim()) {
      jobs.push({ url: r.chapters_url.trim(), name: `chapters/${prefix}.chapters.json` })
    }
  }

  const entries: ZipEntry[] = []
  const missing: string[] = []
  let total = 0
  let capped = false

  await pooled(jobs, FETCH_CONCURRENCY, async (job) => {
    if (capped) return
    const data = await fetchFile(job.url)
    if (!data) {
      missing.push(job.name)
      return
    }
    total += data.length
    if (total > MAX_TOTAL_BYTES) {
      capped = true
      return
    }
    entries.push({ name: job.name, data })
  })

  if (capped) {
    throw createError({
      statusCode: 413,
      statusMessage: `Archive would exceed ${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)} MB. ` +
        'Narrow it with ?include=transcripts or ?status=published.',
    })
  }

  entries.sort((a, b) => a.name.localeCompare(b.name))

  // A manifest so the archive explains itself a year from now, and records
  // anything that couldn't be fetched rather than silently omitting it.
  const podcast = db.prepare('SELECT title FROM podcasts WHERE id = ?').get(podcastId) as { title: string } | undefined
  entries.unshift({
    name: 'README.txt',
    data: Buffer.from(
      `${podcast?.title || slug} — transcripts export\n` +
      `Generated ${new Date().toISOString()} by Podshelf.\n\n` +
      `Episodes in this podcast: ${rows.length}\n` +
      `Files included: ${entries.length}\n` +
      (missing.length
        ? `\nCould not be fetched (${missing.length}):\n${missing.map((m) => `  ${m}`).join('\n')}\n`
        : '\nAll referenced files were fetched successfully.\n') +
      `\nTranscripts are SRT (or WebVTT) text. Chapters are Podcasting 2.0 JSON.\n` +
      `Filenames are prefixed with the Podshelf episode id so they sort chronologically.\n`,
      'utf8',
    ),
  })

  const zip = buildZip(entries)
  const stamp = new Date().toISOString().slice(0, 10)
  setHeader(event, 'Content-Type', 'application/zip')
  setHeader(event, 'Content-Disposition',
    `attachment; filename="${safeEntryName(slug)}-transcripts-${stamp}.zip"`)
  setHeader(event, 'Content-Length', zip.length)
  setHeader(event, 'Cache-Control', 'no-store')
  return zip
})
