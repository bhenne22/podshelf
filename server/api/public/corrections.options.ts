import { defineEventHandler, getHeader, setResponseStatus } from 'h3'
import { applyPublicCors } from '../../utils/public-cors'

/**
 * CORS preflight for POST /api/public/corrections.
 *
 * The form posts `Content-Type: application/json`, which is not a
 * CORS-simple content type, so browsers send an OPTIONS first. There's no
 * body here to name a podcast, so the allowlist check is against every
 * active podcast's website origin.
 */
export default defineEventHandler((event) => {
  applyPublicCors(event, getHeader(event, 'origin'))
  setResponseStatus(event, 204)
  return null
})
