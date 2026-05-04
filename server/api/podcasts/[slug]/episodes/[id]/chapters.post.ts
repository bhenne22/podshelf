import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../../utils/auth'
import { parseChapterLines, uploadChaptersJson } from '../../../../../utils/chapters'
import { bumpFeedLastModified } from '../../../../../utils/feed-cache'
import { maybeAutoTrigger } from '../../../../../utils/github'
import { logAudit } from '../../../../../utils/audit'
import getDb from '../../../../../db/index'

/**
 * POST /api/podcasts/[slug]/episodes/[id]/chapters
 *
 * Body: { text: "MM:SS Title\n…" }
 *
 * Parses the textarea form of chapters, uploads the resulting JSON to the
 * podcast's audio storage directory next to the MP3, and saves the public
 * URL on the episode row.
 *
 * Empty / blank text clears the chapters_url. (Doesn't delete the prior
 * sidecar JSON from storage — orphaning is preferable to deleting and
 * leaving a broken `<podcast:chapters>` URL if anyone has the file cached.)
 */
export default defineEventHandler(async (event) => {
  const slugParam = getRouterParam(event, 'slug') as string
  const id = Number(getRouterParam(event, 'id'))
  const { user, podcastId } = requirePodcastAccess(event, slugParam)

  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'episode id required' })
  }

  const db = getDb()
  const ep = db.prepare('SELECT id, slug, status FROM episodes WHERE id = ? AND podcast_id = ?')
    .get(id, podcastId) as { id: number; slug: string; status: string } | undefined
  if (!ep) {
    throw createError({ statusCode: 404, statusMessage: 'Episode not found' })
  }

  const body = await readBody(event)
  const text = String(body?.text ?? '').trim()

  if (!text) {
    db.prepare(`UPDATE episodes SET chapters_url = NULL, updated_at = datetime('now') WHERE id = ?`).run(id)
    logAudit({
      podcastId,
      userId: user.id,
      action: 'episode.chapters.clear',
      entityType: 'episode',
      entityId: id,
      summary: `Cleared chapters on episode ${ep.slug}`,
    })
    if (ep.status === 'published') {
      bumpFeedLastModified(podcastId)
      maybeAutoTrigger(podcastId, 'episode-chapters-clear')
    }
    return { chapters_url: null, count: 0 }
  }

  const chapters = parseChapterLines(text)
  if (chapters.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No chapters parsed. Format each line as "MM:SS Title" or "HH:MM:SS Title".',
    })
  }

  const filename = `${ep.slug}.chapters.json`
  let url: string
  try {
    url = await uploadChaptersJson(podcastId, filename, chapters)
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err) throw err
    throw createError({
      statusCode: 500,
      statusMessage: err instanceof Error ? err.message : 'Failed to upload chapters JSON',
    })
  }

  db.prepare(`UPDATE episodes SET chapters_url = ?, updated_at = datetime('now') WHERE id = ?`).run(url, id)

  logAudit({
    podcastId,
    userId: user.id,
    action: 'episode.chapters.update',
    entityType: 'episode',
    entityId: id,
    summary: `Updated chapters on episode ${ep.slug} (${chapters.length} chapter${chapters.length === 1 ? '' : 's'})`,
    details: { chapters_url: url, count: chapters.length },
  })

  if (ep.status === 'published') {
    bumpFeedLastModified(podcastId)
    maybeAutoTrigger(podcastId, 'episode-chapters-update')
  }

  return { chapters_url: url, count: chapters.length }
})
