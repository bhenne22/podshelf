import { defineEventHandler, setResponseStatus, setHeader } from 'h3'
import getDb from '../db/index'

/**
 * GET /healthz
 *
 * Liveness + DB ping for uptime-kuma. Returns 200 with `{ status: 'ok' }`
 * when the DB responds to a trivial query, 503 otherwise.
 */
export default defineEventHandler((event) => {
  setHeader(event, 'Cache-Control', 'no-store')

  try {
    const result = getDb().prepare('SELECT 1 AS ok').get() as { ok: number } | undefined
    if (result?.ok !== 1) {
      throw new Error('Unexpected DB ping response')
    }
    return { status: 'ok' }
  } catch (err) {
    setResponseStatus(event, 503)
    return {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    }
  }
})
