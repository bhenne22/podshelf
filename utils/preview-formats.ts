/**
 * Parsers for chapter & transcript files used by the preview page.
 * Kept in the shared `utils/` directory so they auto-import in pages
 * and components without a manual import statement.
 */

export interface Chapter {
  startTime: number
  title: string
  url?: string | null
  img?: string | null
}

export interface TranscriptCue {
  startTime: number
  endTime: number
  body: string
  speaker?: string | null
}

export interface TranscriptPayload {
  /** Cues to highlight in sync with playback. Empty for non-timed formats. */
  cues: TranscriptCue[]
  /** True when the format includes timing info (SRT / VTT / JSON). */
  synced: boolean
  /** Raw text to render when no cues are available (HTML, plain text). */
  raw?: string
  /** "html" | "text" | "synced" — drives the renderer in the UI. */
  mode: 'html' | 'text' | 'synced'
}

/* ------------------------------------------------------------------ chapters */

/**
 * Parses a Podcasting 2.0 chapters JSON document. Spec:
 * https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/examples/chapters/jsonChapters.md
 */
export function parseChaptersJson(text: string): Chapter[] {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    return []
  }
  if (!doc || typeof doc !== 'object') return [];
  const chapters = (doc as { chapters?: unknown }).chapters
  if (!Array.isArray(chapters)) return []

  const out: Chapter[] = []
  for (const c of chapters) {
    if (!c || typeof c !== 'object') continue
    const startTime = Number((c as { startTime?: unknown }).startTime)
    const title = String((c as { title?: unknown }).title ?? '').trim()
    if (!Number.isFinite(startTime) || !title) continue
    const url = (c as { url?: unknown }).url
    const img = (c as { img?: unknown }).img
    out.push({
      startTime,
      title,
      url: typeof url === 'string' && url ? url : null,
      img: typeof img === 'string' && img ? img : null,
    })
  }
  return out.sort((a, b) => a.startTime - b.startTime)
}

/* ------------------------------------------------------------------ transcripts */

/**
 * Dispatches by content-type. Returns a payload describing how the UI
 * should render — synced cues, raw HTML, or raw text.
 */
export function parseTranscript(text: string, contentType: string | null | undefined): TranscriptPayload {
  const ct = (contentType || '').toLowerCase()

  if (ct.includes('html')) {
    return { cues: [], synced: false, raw: text, mode: 'html' }
  }
  if (ct.includes('vtt')) {
    return { cues: parseVtt(text), synced: true, mode: 'synced' }
  }
  if (ct.includes('srt') || ct.includes('subrip')) {
    return { cues: parseSrt(text), synced: true, mode: 'synced' }
  }
  if (ct.includes('json')) {
    return { cues: parseJsonTranscript(text), synced: true, mode: 'synced' }
  }
  // Fallback heuristics on the body itself — content-type is sometimes wrong.
  const trimmed = text.trimStart()
  if (trimmed.startsWith('WEBVTT')) {
    return { cues: parseVtt(text), synced: true, mode: 'synced' }
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const cues = parseJsonTranscript(text)
    if (cues.length) return { cues, synced: true, mode: 'synced' }
  }
  if (/^\d+\s*\r?\n\d{2}:\d{2}:\d{2}/.test(trimmed)) {
    return { cues: parseSrt(text), synced: true, mode: 'synced' }
  }

  return { cues: [], synced: false, raw: text, mode: 'text' }
}

/**
 * Podcasting 2.0 closed-captions JSON format.
 * https://github.com/Podcastindex-org/podcast-namespace/blob/main/transcripts/transcripts.md
 */
export function parseJsonTranscript(text: string): TranscriptCue[] {
  let doc: unknown
  try { doc = JSON.parse(text) } catch { return [] }
  if (!doc || typeof doc !== 'object') return []
  const segments = (doc as { segments?: unknown }).segments
  if (!Array.isArray(segments)) return []

  const out: TranscriptCue[] = []
  for (const s of segments) {
    if (!s || typeof s !== 'object') continue
    const startTime = Number((s as { startTime?: unknown }).startTime)
    const endTime = Number((s as { endTime?: unknown }).endTime)
    const body = String((s as { body?: unknown }).body ?? '').trim()
    if (!Number.isFinite(startTime) || !body) continue
    const speaker = (s as { speaker?: unknown }).speaker
    out.push({
      startTime,
      endTime: Number.isFinite(endTime) ? endTime : startTime + 4,
      body,
      speaker: typeof speaker === 'string' && speaker ? speaker : null,
    })
  }
  return out.sort((a, b) => a.startTime - b.startTime)
}

/** Parses WebVTT. Tolerates blank lines and identifier lines before timestamps. */
export function parseVtt(text: string): TranscriptCue[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const out: TranscriptCue[] = []
  let i = 0

  // Skip the WEBVTT header + any leading metadata lines.
  while (i < lines.length && !/-->/.test(lines[i])) i++

  while (i < lines.length) {
    const arrowLine = lines[i]
    if (!arrowLine || !/-->/.test(arrowLine)) { i++; continue }

    const m = arrowLine.match(/^\s*([0-9:.,]+)\s*-->\s*([0-9:.,]+)/)
    if (!m) { i++; continue }
    const startTime = parseTimestamp(m[1])
    const endTime = parseTimestamp(m[2])
    i++

    const bodyLines: string[] = []
    while (i < lines.length && lines[i].trim() !== '') {
      bodyLines.push(lines[i])
      i++
    }
    // Skip the blank separator + any subsequent identifier line.
    while (i < lines.length && lines[i].trim() === '') i++
    while (i < lines.length && !/-->/.test(lines[i]) && lines[i].trim() !== '') {
      // Looks like a cue identifier — peek ahead; if the next line is a timestamp, this was an id.
      if (i + 1 < lines.length && /-->/.test(lines[i + 1])) { i++; break }
      // Otherwise treat as body of the previous cue (rare, malformed).
      i++
    }

    const body = bodyLines.join('\n').trim()
    if (Number.isFinite(startTime) && body) {
      out.push({
        startTime,
        endTime: Number.isFinite(endTime) ? endTime : startTime + 4,
        body: stripVttTags(body),
      })
    }
  }
  return out
}

/** Parses SubRip (SRT). */
export function parseSrt(text: string): TranscriptCue[] {
  const blocks = text.replace(/^﻿/, '').split(/\r?\n\r?\n/)
  const out: TranscriptCue[] = []
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter((l) => l.length > 0)
    if (lines.length < 2) continue
    // First line may be the index, second is the timestamp.
    const tsLine = /-->/.test(lines[0]) ? lines[0] : lines[1]
    const bodyStart = /-->/.test(lines[0]) ? 1 : 2
    const m = tsLine.match(/([0-9:.,]+)\s*-->\s*([0-9:.,]+)/)
    if (!m) continue
    const startTime = parseTimestamp(m[1])
    const endTime = parseTimestamp(m[2])
    const body = lines.slice(bodyStart).join('\n').trim()
    if (!body || !Number.isFinite(startTime)) continue
    out.push({
      startTime,
      endTime: Number.isFinite(endTime) ? endTime : startTime + 4,
      body: stripVttTags(body),
    })
  }
  return out
}

/** Accepts `HH:MM:SS.mmm`, `HH:MM:SS,mmm`, `MM:SS.mmm`, or seconds-as-number. */
function parseTimestamp(s: string): number {
  const t = s.trim().replace(',', '.')
  if (!t) return NaN
  const parts = t.split(':').map((p) => Number(p))
  if (parts.some((n) => !Number.isFinite(n))) return NaN
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 1) return parts[0]
  return NaN
}

function stripVttTags(s: string): string {
  // Drop voice tags <v Bob> and styling spans, keep the readable text.
  return s.replace(/<\/?[^>]+>/g, '').trim()
}

/** Format seconds as `M:SS` or `H:MM:SS` for display. */
export function formatChapterTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}
