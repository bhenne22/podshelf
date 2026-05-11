/**
 * Helpers for round-tripping timestamps through `<input type="datetime-local">`.
 *
 * The input's value is a tz-naive string ("YYYY-MM-DDTHH:MM"). The user types
 * it intending a specific timezone — for Podshelf that's the podcast's
 * configured IANA timezone, not the browser's. We convert at the form
 * boundary so the server only ever sees UTC ISO timestamps.
 */

/**
 * Format a UTC instant as a wall-clock object in the target IANA zone.
 * Uses `hourCycle: 'h23'` so midnight is "00", not "24" (which en-US
 * surfaces with `hour12: false`).
 */
function partsInZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)!.value
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

/**
 * Convert a UTC ISO timestamp from the server into the wall-clock string
 * that `<input type="datetime-local">` expects, expressed in `timeZone`.
 * Returns '' for null/invalid input.
 */
export function utcIsoToLocalInput(
  iso: string | null | undefined,
  timeZone: string,
): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = partsInZone(d, timeZone)
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

/**
 * Convert a datetime-local input value (interpreted as a wall-clock time in
 * `timeZone`) into a UTC ISO string suitable for the server. Returns null
 * for empty/invalid input.
 *
 * The standard "guess and correct" technique: treat the input as if it were
 * UTC to get a starting instant, then see what wall-clock that instant
 * actually has in the target zone. The delta is the zone's offset at that
 * moment; subtracting it from the guess gives the real UTC instant.
 *
 * DST edge cases:
 *   - Spring forward (lost hour): inputs in the missing window resolve to
 *     a nearby valid instant. Not ideal but acceptable for scheduling.
 *   - Fall back (repeated hour): we pick one of the two ambiguous instants
 *     deterministically (the one before the offset change).
 */
export function localInputToUtcIso(
  local: string | null | undefined,
  timeZone: string,
): string | null {
  if (!local) return null
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return null
  const [, y, mo, d, h, mi, s = '00'] = m

  const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)
  const seen = partsInZone(new Date(guess), timeZone)
  const seenUtc = Date.UTC(
    +seen.year, +seen.month - 1, +seen.day,
    +seen.hour, +seen.minute, +seen.second,
  )
  const offset = seenUtc - guess
  return new Date(guess - offset).toISOString()
}

/**
 * Browser's current IANA timezone — used as a fallback when no podcast TZ
 * is available (e.g. a brand-new podcast page before its row has loaded).
 */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

/**
 * Best-effort abbreviation for the zone at the given moment (e.g. "PDT",
 * "EST", "GMT+1"). Use for inline UI hints next to a datetime-local input.
 */
export function tzAbbreviation(timeZone: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'short',
    }).formatToParts(at)
    return parts.find((p) => p.type === 'timeZoneName')?.value || timeZone
  } catch {
    return timeZone
  }
}
