/**
 * Decode HTML/XML entities in plain-text fields.
 *
 * Use only for fields that are NOT HTML (titles, names) — HTML fields like
 * episode descriptions must keep their entities so they render correctly.
 *
 * The case that matters: WordPress wraps <title> in CDATA and emits numeric
 * character references like &#8211; (en-dash), &#8217; (right single quote),
 * &#8230; (ellipsis). XML parsers preserve CDATA verbatim, so the decoder
 * has to run in user-space.
 */
export function decodeEntities(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .replace(/&#(\d+);/g, (_, n) => safeFromCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeFromCode(parseInt(h, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (m, name) => {
      switch (name) {
        case 'amp': return '&'
        case 'lt': return '<'
        case 'gt': return '>'
        case 'quot': return '"'
        case 'apos': return "'"
        case 'nbsp': return ' '
        default: return m
      }
    })
}

function safeFromCode(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return ''
  try {
    return String.fromCodePoint(n)
  } catch {
    return ''
  }
}

/**
 * Pull an episode number out of a title using the `#N` convention common in
 * WordPress podcast titles ("SI #146 – …", "Subtle Interference #58 …").
 * Strict on purpose: only matches `#` followed by digits so we don't
 * misread years or other digit clusters as episode numbers.
 *
 * Returns null when the title doesn't fit the pattern — leaving
 * episode_number unset is the right answer for "specials" / interludes.
 */
export function inferEpisodeNumberFromTitle(title: string | null | undefined): number | null {
  if (!title) return null
  const m = title.match(/#\s*(\d+)/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) && n > 0 ? n : null
}
