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
 * Lowercase, ASCII-only, hyphen-separated slug derived from arbitrary text.
 * Strips characters outside [a-z0-9 -], collapses whitespace and repeated
 * hyphens, and trims leading/trailing hyphens. Returns "" if no slug-worthy
 * characters survive (emoji-only input, etc.).
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * True when a slug looks like the auto-generated placeholder assigned to a
 * title-less draft (`untitled-YYYY-MM-DD` with an optional collision suffix
 * like `-2`, `-3`). Used by the PATCH handler to decide whether to regenerate
 * the slug from a freshly-added title rather than leave the placeholder stuck.
 */
export function isPlaceholderSlug(slug: string | null | undefined): boolean {
  if (!slug) return false
  return /^untitled-\d{4}-\d{2}-\d{2}(-\d+)?$/.test(slug)
}

/**
 * Pull an episode number out of a title.
 *
 * Patterns recognized, in priority order:
 *   - `Episode N` anchored at the start ("Episode 24: Darcy Is A Sociopath")
 *   - `Ep N` / `Ep. N` near the start, optionally preceded by a short
 *     show-prefix abbreviation ("IWVT Ep. 128 – Black Beam Burrito",
 *     "Ep. 12: Title"). Limited to one short prefix word so sub-series
 *     like "Philosophical Whacks Ep. 2" stay null and get the
 *     unnumbered-import warning instead.
 *   - `#N` anywhere in the title — common in WordPress / PowerPress
 *     ("SI #146 – …").
 *
 * Sub-series suffix-letters are naturally rejected: `\b` after `\d+`
 * fails on "Ep. 77B" because `B` is a word character.
 *
 * Returns null when the title doesn't fit any pattern — leaving
 * episode_number unset is the right answer for "specials" / interludes.
 */
export function inferEpisodeNumberFromTitle(title: string | null | undefined): number | null {
  if (!title) return null
  const m = title.match(/^\s*Episode\s+(\d+)\b/i)
         || title.match(/^\s*(?:\S{1,8}\s+)?Ep\.?\s+(\d+)\b/i)
         || title.match(/#\s*(\d+)/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) && n > 0 ? n : null
}
