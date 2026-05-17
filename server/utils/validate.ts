import { createError } from 'h3'

const VALID_STATUSES = ['draft', 'published', 'scheduled']
const VALID_EPISODE_TYPES = ['full', 'trailer', 'bonus']
const VALID_EPISODE_EXPLICIT = ['true', 'false']
const VALID_TRANSCRIPT_TYPES = [
  'text/html',
  'text/plain',
  'application/srt',
  'application/x-subrip',
  'text/vtt',
  'application/json',
]

export function validateEpisodeFields(body: Record<string, unknown>) {
  if (body.episode_number != null) {
    const n = Number(body.episode_number)
    if (!Number.isInteger(n) || n < 1) {
      throw createError({ statusCode: 400, statusMessage: 'episode_number must be a positive integer' })
    }
  }

  if (body.season_number != null) {
    const n = Number(body.season_number)
    if (!Number.isInteger(n) || n < 1) {
      throw createError({ statusCode: 400, statusMessage: 'season_number must be a positive integer' })
    }
  }

  if (body.status != null && !VALID_STATUSES.includes(body.status as string)) {
    throw createError({ statusCode: 400, statusMessage: `status must be one of: ${VALID_STATUSES.join(', ')}` })
  }

  if (body.episode_type != null && !VALID_EPISODE_TYPES.includes(body.episode_type as string)) {
    throw createError({ statusCode: 400, statusMessage: `episode_type must be one of: ${VALID_EPISODE_TYPES.join(', ')}` })
  }

  if (body.itunes_explicit != null && body.itunes_explicit !== ''
      && !VALID_EPISODE_EXPLICIT.includes(body.itunes_explicit as string)) {
    throw createError({ statusCode: 400, statusMessage: `itunes_explicit must be 'true' or 'false'` })
  }

  if (body.transcript_type != null && body.transcript_type !== ''
      && !VALID_TRANSCRIPT_TYPES.includes(body.transcript_type as string)) {
    throw createError({
      statusCode: 400,
      statusMessage: `transcript_type must be one of: ${VALID_TRANSCRIPT_TYPES.join(', ')}`,
    })
  }

  if (body.published_at != null && body.published_at !== '') {
    const d = new Date(body.published_at as string)
    if (isNaN(d.getTime())) {
      throw createError({ statusCode: 400, statusMessage: 'published_at must be a valid date' })
    }
  }

  if (body.recording_starts_at != null && body.recording_starts_at !== '') {
    const d = new Date(body.recording_starts_at as string)
    if (isNaN(d.getTime())) {
      throw createError({ statusCode: 400, statusMessage: 'recording_starts_at must be a valid date' })
    }
  }

  if (body.recording_duration_minutes != null && body.recording_duration_minutes !== '') {
    const n = Number(body.recording_duration_minutes)
    if (!Number.isInteger(n) || n <= 0) {
      throw createError({ statusCode: 400, statusMessage: 'recording_duration_minutes must be a positive integer' })
    }
  }
}
