import { createError } from 'h3'

const VALID_STATUSES = ['draft', 'published']
const VALID_EPISODE_TYPES = ['full', 'trailer', 'bonus']

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

  if (body.published_at != null && body.published_at !== '') {
    const d = new Date(body.published_at as string)
    if (isNaN(d.getTime())) {
      throw createError({ statusCode: 400, statusMessage: 'published_at must be a valid date' })
    }
  }
}
