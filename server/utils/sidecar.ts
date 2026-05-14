// Format validators + content summarizers for per-episode sidecar files
// (transcripts: SRT/VTT/JSON; chapters: Podcasting 2.0 JSON).
//
// Pure functions only. The HTTP-fetch wrapper lives in the probe endpoint.

export interface Cue {
  t: number
  speaker: string
  text: string
}

export interface TranscriptSummary {
  kind: 'srt' | 'vtt' | 'json'
  cueCount: number
  durationSeconds: number
  speakers: string[]
  preview: string
}

export interface ChaptersSummary {
  version: string | null
  chapterCount: number
  lastStartSeconds: number
  titles: string[]
}

export interface ValidationResult<T> {
  ok: boolean
  summary: T | null
  errors: string[]
}

// Parse "HH:MM:SS,mmm" / "HH:MM:SS.mmm" / "MM:SS.mmm" → seconds. NaN on bad input.
export function parseTimestamp(ts: string): number {
  const m = ts.trim().match(/^(?:(\d+):)?(\d+):(\d+)[,.](\d+)$/)
  if (!m) return NaN
  const h = m[1] ? parseInt(m[1], 10) : 0
  const min = parseInt(m[2], 10)
  const sec = parseInt(m[3], 10)
  const ms = parseInt(m[4], 10)
  return h * 3600 + min * 60 + sec + ms / 1000
}

export function parseSrt(raw: string): Cue[] {
  const blocks = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split(/\n\s*\n+/)
  const cues: Cue[] = []
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.length > 0)
    if (lines.length < 2) continue
    const tsLineIdx = /^\d+$/.test(lines[0]) ? 1 : 0
    const tsLine = lines[tsLineIdx]
    const tsMatch = tsLine && tsLine.match(/^([\d:,.]+)\s*-->\s*([\d:,.]+)/)
    if (!tsMatch) continue
    const t = parseTimestamp(tsMatch[1])
    if (Number.isNaN(t)) continue
    let text = lines.slice(tsLineIdx + 1).join(' ').trim()
    let speaker = ''
    const spMatch = text.match(/^([A-Z][A-Z0-9 _-]{0,15}):\s*(.+)$/)
                 || text.match(/^\[([A-Z][A-Z0-9 _-]{0,15})\]\s*(.+)$/)
    if (spMatch) {
      speaker = spMatch[1].trim()
      text = spMatch[2].trim()
    }
    cues.push({ t: Math.round(t * 100) / 100, speaker, text })
  }
  return cues
}

export function parseVtt(raw: string): Cue[] {
  const noHeader = raw.replace(/^WEBVTT[^\n]*\n/, '')
  const blocks = noHeader.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split(/\n\s*\n+/)
  const cues: Cue[] = []
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.length > 0)
    const tsLineIdx = lines.findIndex((l) => /-->/.test(l))
    if (tsLineIdx < 0) continue
    const tsMatch = lines[tsLineIdx].match(/^([\d:,.]+)\s*-->\s*([\d:,.]+)/)
    if (!tsMatch) continue
    const t = parseTimestamp(tsMatch[1])
    if (Number.isNaN(t)) continue
    let text = lines.slice(tsLineIdx + 1).join(' ').trim()
    let speaker = ''
    const vMatch = text.match(/^<v\s+([^>]+)>(.+?)(?:<\/v>)?$/i)
    if (vMatch) {
      speaker = vMatch[1].trim()
      text = vMatch[2].trim()
    }
    cues.push({ t: Math.round(t * 100) / 100, speaker, text })
  }
  return cues
}

function summarizeCues(kind: 'srt' | 'vtt' | 'json', cues: Cue[]): TranscriptSummary {
  const speakers = Array.from(new Set(cues.map((c) => c.speaker).filter((s) => s.length > 0))).sort()
  const durationSeconds = cues.length > 0 ? cues[cues.length - 1].t : 0
  const preview = cues.slice(0, 3).map((c) => (c.speaker ? `${c.speaker}: ${c.text}` : c.text)).join(' • ').slice(0, 200)
  return { kind, cueCount: cues.length, durationSeconds, speakers, preview }
}

// Decide which transcript parser to use. Returns null when the format isn't
// one we can summarize (HTML, plain text) — those still pass the
// reachability check at the endpoint level.
function detectTranscriptKind(contentType: string, urlHint: string): 'srt' | 'vtt' | 'json' | null {
  const lc = (contentType || '').toLowerCase()
  const hint = (urlHint || '').toLowerCase()
  if (lc.includes('srt') || lc.includes('subrip')) return 'srt'
  if (lc.includes('vtt')) return 'vtt'
  if (lc.includes('json')) return 'json'
  if (hint.endsWith('.srt')) return 'srt'
  if (hint.endsWith('.vtt')) return 'vtt'
  if (hint.endsWith('.json')) return 'json'
  return null
}

export function validateTranscript(
  text: string,
  contentType: string,
  urlHint: string,
): ValidationResult<TranscriptSummary> {
  const kind = detectTranscriptKind(contentType, urlHint)
  if (!kind) {
    return { ok: true, summary: null, errors: [] }
  }
  try {
    let cues: Cue[]
    if (kind === 'srt') cues = parseSrt(text)
    else if (kind === 'vtt') cues = parseVtt(text)
    else cues = JSON.parse(text) as Cue[]

    if (!Array.isArray(cues)) {
      return { ok: false, summary: null, errors: [`Parsed ${kind.toUpperCase()} but result is not an array of cues.`] }
    }
    if (cues.length === 0) {
      return { ok: false, summary: null, errors: [`Parsed ${kind.toUpperCase()} but found zero cues. File may be malformed.`] }
    }
    return { ok: true, summary: summarizeCues(kind, cues), errors: [] }
  } catch (err) {
    return {
      ok: false,
      summary: null,
      errors: [`Failed to parse ${kind.toUpperCase()}: ${err instanceof Error ? err.message : String(err)}`],
    }
  }
}

export function validateChaptersJson(text: string): ValidationResult<ChaptersSummary> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    return { ok: false, summary: null, errors: [`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`] }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, summary: null, errors: ['Chapters JSON must be an object at the top level.'] }
  }
  const obj = parsed as Record<string, unknown>
  const chapters = obj.chapters
  if (!Array.isArray(chapters)) {
    return { ok: false, summary: null, errors: ['Missing or invalid `chapters` array (Podcasting 2.0 spec requires `{ chapters: [...] }`).'] }
  }
  const errors: string[] = []
  let lastStartSeconds = 0
  const titles: string[] = []
  let prevStart = -Infinity
  for (let i = 0; i < chapters.length; i++) {
    const c = chapters[i] as Record<string, unknown> | null
    if (!c || typeof c !== 'object') {
      errors.push(`chapters[${i}] is not an object.`)
      continue
    }
    if (typeof c.startTime !== 'number' || Number.isNaN(c.startTime as number)) {
      errors.push(`chapters[${i}].startTime is missing or not a number.`)
      continue
    }
    if (typeof c.title !== 'string' || (c.title as string).length === 0) {
      errors.push(`chapters[${i}].title is missing or empty.`)
    }
    if ((c.startTime as number) < prevStart) {
      errors.push(`chapters[${i}].startTime (${c.startTime}) is earlier than the previous chapter — list should be sorted ascending.`)
    }
    prevStart = c.startTime as number
    lastStartSeconds = Math.max(lastStartSeconds, c.startTime as number)
    if (typeof c.title === 'string') titles.push(c.title)
  }
  if (chapters.length === 0) {
    errors.push('Chapters array is empty.')
  }
  if (errors.length > 0) {
    return { ok: false, summary: null, errors }
  }
  return {
    ok: true,
    summary: {
      version: typeof obj.version === 'string' ? (obj.version as string) : null,
      chapterCount: chapters.length,
      lastStartSeconds,
      titles,
    },
    errors: [],
  }
}

export function formatHms(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}
