import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Signed "add to calendar" links for a single episode's recording slot.
 *
 * These end up in chat messages (Discord/Slack), where there's no per-user
 * auth — anyone who can read the channel can click. So the link is an opaque
 * signed token rather than a bare episode id: it can't be enumerated, and it
 * can't be edited into a different episode's calendar entry.
 *
 * The token deliberately carries the disclosure flag as *signed* data. A
 * webhook with `include_recording_link` off emits `…-0-…`; flipping that byte
 * to `1` invalidates the signature, so a link posted in a public channel can
 * never be tampered into revealing the recording room URL. See
 * server/routes/schedule/event/[token].ics.ts for the consuming side.
 *
 * Unlike `schedule_tokens` (per-user rows, revocable individually) these are
 * stateless — derived from NUXT_SECRET_KEY, so there's no table to write on
 * every webhook fire. Rotating that secret invalidates every outstanding link,
 * which is the intended blast radius for a "someone forwarded the message"
 * problem.
 */

const TOKEN_VERSION = 'v1'
// 20 bytes of base64url ≈ 160 bits — far past guessing range, still short
// enough to sit in a chat message without wrapping.
const SIG_LENGTH = 27

function secret(): string {
  const s = process.env.NUXT_SECRET_KEY || ''
  if (!s) {
    // Same posture as the session signer: refuse to mint something that only
    // looks signed. Callers treat a throw as "skip the calendar link".
    throw new Error('NUXT_SECRET_KEY is required to sign calendar links')
  }
  return s
}

function sign(payload: string): string {
  return createHmac('sha256', secret())
    .update(`${TOKEN_VERSION}:${payload}`)
    .digest('base64url')
    .slice(0, SIG_LENGTH)
}

/**
 * Build the token for an episode. `includeRecordingLink` is bound into the
 * signature, so the same episode yields two distinct, non-interchangeable
 * tokens depending on what the emitting webhook is allowed to disclose.
 */
export function signEventCalendarToken(episodeId: number, includeRecordingLink: boolean): string {
  const flag = includeRecordingLink ? '1' : '0'
  const payload = `${episodeId}-${flag}`
  return `${payload}-${sign(payload)}`
}

export interface EventCalendarToken {
  episodeId: number
  includeRecordingLink: boolean
}

/** Verify + parse. Returns null for anything malformed or mis-signed. */
export function verifyEventCalendarToken(token: string): EventCalendarToken | null {
  const m = /^(\d+)-([01])-([A-Za-z0-9_-]+)$/.exec(token)
  if (!m) return null
  const [, idStr, flag, providedSig] = m

  const payload = `${idStr}-${flag}`
  let expectedSig: string
  try {
    expectedSig = sign(payload)
  } catch {
    return null
  }

  // Length check first — timingSafeEqual throws on a length mismatch, and a
  // wrong-length signature is public information anyway.
  if (providedSig.length !== expectedSig.length) return null
  if (!timingSafeEqual(Buffer.from(providedSig), Buffer.from(expectedSig))) return null

  const episodeId = Number(idStr)
  if (!Number.isSafeInteger(episodeId) || episodeId <= 0) return null

  return { episodeId, includeRecordingLink: flag === '1' }
}
