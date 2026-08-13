import { defineEventHandler, setHeader, createError } from 'h3'
import getDb from '../../../db/index'
import { renderIcsFeed, type IcsEpisode } from '../../../utils/ics'
import { verifyEventCalendarToken } from '../../../utils/event-calendar-token'

/**
 * GET /schedule/event/<token>.ics
 *
 * One-off "add to calendar" download for a single episode's recording slot.
 * Unauthenticated by design: the link is handed out in chat messages
 * (Discord/Slack) where there is no per-user session, so the signed token IS
 * the credential. See server/utils/event-calendar-token.ts.
 *
 * Distinct from /schedule/[token].ics, which is a *subscription* feed scoped
 * to a user and covering a whole podcast or network. This route serves exactly
 * one VEVENT and is meant to be downloaded once, not polled.
 *
 * Disclosure of the recording room URL is carried in the signed token, so a
 * link emitted by a webhook with include_recording_link off cannot be edited
 * into one that reveals the room.
 */

interface EpisodeRow {
  id: number
  title: string
  slug: string
  description: string | null
  status: string
  published_at: string | null
  recording_starts_at: string | null
  effective_duration_minutes: number | null
  recording_location_type: string | null
  recording_link: string | null
  updated_at: string
  podcast_title: string
  podcast_website: string | null
  podcast_status: string
}

export default defineEventHandler((event) => {
  // Nitro's `[token].ics` binding doesn't reliably populate the param (the
  // literal .ics eats it), so parse the path ourselves — same pattern as
  // schedule/[token].ics.ts and feeds/[slug].xml.ts.
  const m = (event.path || '').match(/^\/schedule\/event\/([^/]+)\.ics(?:\?|$)/)
  const tokenStr = m?.[1]
  if (!tokenStr) {
    throw createError({ statusCode: 404, statusMessage: 'Bad calendar URL' })
  }

  const parsed = verifyEventCalendarToken(tokenStr)
  if (!parsed) {
    throw createError({ statusCode: 404, statusMessage: 'Calendar event not found' })
  }

  const db = getDb()
  const row = db.prepare(`
    SELECT
      e.id, e.title, e.slug, e.description, e.status,
      e.published_at, e.recording_starts_at,
      COALESCE(e.recording_duration_minutes, p.recording_default_duration_minutes)
        AS effective_duration_minutes,
      e.recording_location_type, e.recording_link,
      e.updated_at,
      p.title   AS podcast_title,
      p.website AS podcast_website,
      p.status  AS podcast_status
    FROM episodes e
    JOIN podcasts p ON p.id = e.podcast_id
    WHERE e.id = ?
  `).get(parsed.episodeId) as EpisodeRow | undefined

  // A deleted episode, a soft-deleted podcast, or a recording slot that has
  // since been cancelled all mean there's no event to hand out. 404 rather
  // than an empty VCALENDAR so the client says "not found" instead of
  // silently importing nothing.
  if (!row || row.podcast_status !== 'active' || !row.recording_starts_at) {
    throw createError({ statusCode: 404, statusMessage: 'Calendar event not found' })
  }

  const icsEpisode: IcsEpisode = {
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    // Force a REC-only render: passing the real status would also emit the
    // DROP event for a scheduled/published episode, and this link is
    // specifically "add the recording session to my calendar".
    status: 'draft',
    published_at: null,
    recording_starts_at: row.recording_starts_at,
    recording_duration_minutes: row.effective_duration_minutes,
    recording_location_type: row.recording_location_type,
    recording_link: row.recording_link,
    updated_at: row.updated_at,
    podcast_title: row.podcast_title,
    podcast_website: row.podcast_website,
  }

  const body = renderIcsFeed([icsEpisode], {
    scopeKind: 'podcast',
    calendarName: `${row.podcast_title} — Recording`,
    includeRecordingLink: parsed.includeRecordingLink,
  })

  setHeader(event, 'Content-Type', 'text/calendar; charset=utf-8')
  // Content-Disposition makes browsers hand the file to the calendar app
  // rather than rendering it as text — the whole point of a one-off link.
  setHeader(event, 'Content-Disposition', `attachment; filename="${row.slug || 'recording'}.ics"`)
  setHeader(event, 'Cache-Control', 'private, max-age=0, must-revalidate')
  return body
})
