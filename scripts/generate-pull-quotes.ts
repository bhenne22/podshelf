/**
 * Generate episode pull quotes from transcripts.
 *
 * Reads a podcast's episodes from the Podshelf API, finds the ones that have a
 * transcript but no pull quotes yet, asks Claude for the best candidates, and
 * imports them through the bulk endpoint. The human then curates in the episode
 * editor — this produces *candidates*, not a finished list.
 *
 *   PODSHELF_API_KEY=pk_… npx tsx scripts/generate-pull-quotes.ts --podcast ywiw
 *
 * It is a gap-filling poll, the same shape as the transcription backfill: safe
 * to re-run, safe on a timer, and it never touches an episode that already has
 * quotes unless you pass --force. Nothing here needs a GPU — only a transcript
 * URL and an Anthropic key — so it can run anywhere with network access.
 *
 * Options:
 *   --podcast <slug>   required
 *   --episode <id>     just this one episode (repeatable)
 *   --limit <n>        stop after n episodes (useful for a first look)
 *   --force            regenerate episodes that already have quotes
 *   --dry-run          print what would be imported, write nothing
 *   --brief <text>     override the per-show brief (required for a new show)
 *   --model <id>       default claude-opus-5
 *   --concurrency <n>  episodes in flight, default 2
 *
 * Env: PODSHELF_API_KEY (required), PODSHELF_URL (default the live instance),
 * ANTHROPIC_API_KEY (or an `ant auth login` profile).
 */

import { existsSync, readFileSync, realpathSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'

// ---------------------------------------------------------------------------
// Per-show briefs
// ---------------------------------------------------------------------------

/**
 * What a good pull quote *is* differs per show, so there is no generic default:
 * an unknown slug is an error unless the caller passes --brief. Getting this
 * wrong is expensive in a way a crash isn't — it quietly fills a show's
 * episodes with quotes selected against the wrong idea of the show.
 */
const SHOW_BRIEFS: Record<string, string> = {
  ywiw: [
    "You're Watching It Wrong is a comedy rewatch podcast. Sass and Erica watch",
    'something and riff on it. The pull quotes are for memorable funny moments —',
    'the lines a listener would clip and send to a friend, or that would make',
    'someone who has never heard the show press play.',
    '',
    'What makes a good one here:',
    '- It lands on its own. A stranger reading it cold should get the joke without',
    '  needing the setup, the episode, or the thing being watched.',
    '- It sounds like a person talking, not a summary of a bit.',
    '- Absurd tangents, indignant rants, oddly specific trivia, and the hosts',
    '  turning on each other all work well.',
    '',
    'What to avoid:',
    '- Plot recap, or anything that is only funny if you watched the episode.',
    '- Long call-and-response exchanges — one voice, one thought.',
    '- Inside references that need five minutes of context to land.',
    '- Anything mean about a real person that reads badly out of context.',
  ].join('\n'),
}

// ---------------------------------------------------------------------------
// CLI + env
// ---------------------------------------------------------------------------

interface Options {
  podcast: string
  episodes: number[]
  limit: number | null
  force: boolean
  dryRun: boolean
  brief: string | null
  model: string
  concurrency: number
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    podcast: '',
    episodes: [],
    limit: null,
    force: false,
    dryRun: false,
    brief: null,
    model: 'claude-opus-5',
    concurrency: 2,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v == null) throw new Error(`${arg} requires a value`)
      return v
    }
    switch (arg) {
      case '--podcast': opts.podcast = next(); break
      case '--episode': opts.episodes.push(Number(next())); break
      case '--limit': opts.limit = Number(next()); break
      case '--force': opts.force = true; break
      case '--dry-run': opts.dryRun = true; break
      case '--brief': opts.brief = next(); break
      case '--model': opts.model = next(); break
      case '--concurrency': opts.concurrency = Number(next()); break
      case '--help': case '-h': printUsageAndExit(0); break
      default:
        console.error(`Unknown argument: ${arg}`)
        printUsageAndExit(1)
    }
  }
  if (!opts.podcast) {
    console.error('--podcast <slug> is required')
    printUsageAndExit(1)
  }
  if (opts.episodes.some((n) => !Number.isFinite(n))) {
    throw new Error('--episode takes a numeric episode id')
  }
  if (!Number.isFinite(opts.concurrency) || opts.concurrency < 1) {
    throw new Error('--concurrency must be a positive integer')
  }
  return opts
}

function printUsageAndExit(code: number): never {
  console.log(`
Usage: npx tsx scripts/generate-pull-quotes.ts --podcast <slug> [options]

  --episode <id>     only this episode (repeatable)
  --limit <n>        stop after n episodes
  --force            regenerate episodes that already have quotes
  --dry-run          print candidates, write nothing
  --brief <text>     override the per-show brief
  --model <id>       default claude-opus-5
  --concurrency <n>  default 2

Known shows: ${Object.keys(SHOW_BRIEFS).join(', ')}
`.trim())
  process.exit(code)
}

/** Same .env loader as scripts/create-admin.ts — real env always wins. */
function loadEnv() {
  const envPath = join(process.cwd(), '.env')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = val
  }
}

// ---------------------------------------------------------------------------
// Podshelf API
// ---------------------------------------------------------------------------

interface EpisodeRow {
  id: number
  slug: string
  title: string | null
  status: string
  audio_duration_seconds: number | null
  transcript_path: string | null
  transcript_type: string | null
}

interface PullQuoteRow {
  id: number
  quote: string
}

class Podshelf {
  constructor(private base: string, private key: string, private slug: string) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.base}/api/podcasts/${this.slug}${path}`, {
      ...init,
      headers: {
        'X-Api-Key': this.key,
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
      },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`${init.method || 'GET'} ${path} → ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 300)}` : ''}`)
    }
    return res.json() as Promise<T>
  }

  listEpisodes() {
    const fields = 'id,slug,title,status,audio_duration_seconds,transcript_path,transcript_type'
    return this.request<EpisodeRow[]>(`/episodes?fields=${fields}`)
  }

  listPullQuotes(episodeId: number) {
    return this.request<PullQuoteRow[]>(`/episodes/${episodeId}/pull-quotes`)
  }

  importPullQuotes(episodeId: number, quotes: OutgoingQuote[]) {
    return this.request<{ added: number; removed: number }>(
      `/episodes/${episodeId}/pull-quotes/bulk`,
      { method: 'POST', body: JSON.stringify({ mode: 'replace', quotes }) },
    )
  }
}

interface OutgoingQuote {
  quote: string
  speaker: string | null
  timecode: string | null
}

// ---------------------------------------------------------------------------
// Transcript parsing
//
// Mirrors the cue shape the downstream site sync already uses ({t, speaker,
// text}) so both read the same transcripts the same way. The pipeline writes
// SRT with a "[Name] " speaker prefix; VTT and its <v Name> form are handled
// too, since transcript_type isn't guaranteed to stay SRT forever.
// ---------------------------------------------------------------------------

export interface Cue {
  t: number
  speaker: string
  text: string
}

function parseTimestamp(ts: string): number {
  const m = ts.trim().match(/^(?:(\d+):)?(\d+):(\d+)[,.](\d+)$/)
  if (!m) return NaN
  const h = m[1] ? parseInt(m[1], 10) : 0
  return h * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + parseInt(m[4], 10) / 1000
}

export function formatTimecode(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

export function parseCues(raw: string, mimeType: string | null, urlHint = ''): Cue[] {
  const body = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/^WEBVTT[^\n]*\n/, '')
  const cues: Cue[] = []
  for (const block of body.trim().split(/\n\s*\n+/)) {
    const lines = block.split('\n').filter((l) => l.length > 0)
    const tsIdx = lines.findIndex((l) => l.includes('-->'))
    if (tsIdx < 0) continue
    const tsMatch = lines[tsIdx].match(/^([\d:,.]+)\s*-->/)
    if (!tsMatch) continue
    const t = parseTimestamp(tsMatch[1])
    if (Number.isNaN(t)) continue

    let text = lines.slice(tsIdx + 1).join(' ').trim()
    let speaker = ''
    const m =
      text.match(/^\[([^\]]{1,40})\]\s*(.+)$/s) ||
      text.match(/^<v\s+([^>]{1,40})>\s*(.+?)(?:<\/v>)?$/is) ||
      text.match(/^([A-Za-z][A-Za-z0-9 _'-]{0,30}):\s*(.+)$/s)
    if (m) {
      speaker = m[1].trim()
      text = m[2].trim()
    }
    if (text) cues.push({ t, speaker, text })
  }
  // A mime type we don't recognise isn't fatal — the cue scan above is
  // format-agnostic enough that a mislabelled file still parses. Only an empty
  // result is a real failure, and the caller reports that.
  void mimeType
  void urlHint
  return cues
}

// ---------------------------------------------------------------------------
// Verification
//
// The transcripts are ASR output: lowercase, thin punctuation, and sentences
// that run across cue boundaries. So the model is asked for a verbatim span but
// allowed to punctuate it, and a quote is verified against a normalized copy of
// the transcript. An offset map back to the cue index gives us the speaker and
// timecode without having to trust the model for either.
// ---------------------------------------------------------------------------

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface TranscriptIndex {
  /** Normalized full text, cues joined by a single space. */
  text: string
  /** For each character in `text`, the index of the cue it came from. */
  cueAt: number[]
  cues: Cue[]
}

export function buildIndex(cues: Cue[]): TranscriptIndex {
  const parts: string[] = []
  const cueAt: number[] = []
  for (let i = 0; i < cues.length; i++) {
    const n = normalize(cues[i].text)
    if (!n) continue
    if (parts.length > 0) {
      parts.push(' ')
      cueAt.push(i)
    }
    parts.push(n)
    for (let c = 0; c < n.length; c++) cueAt.push(i)
  }
  return { text: parts.join(''), cueAt, cues }
}

export type Verified =
  | { ok: true; quote: string; speaker: string | null; timecode: string | null }
  | { ok: false; reason: string }

/**
 * Confirm the quote actually appears in the transcript, and derive its speaker
 * and timecode from where it landed. A span that crosses a speaker change is
 * rejected: it reads as one person's line but isn't, which is worse than a
 * missing candidate.
 */
export function verify(index: TranscriptIndex, quote: string): Verified {
  const needle = normalize(quote)
  // A fragment this small is both a bad pull quote and likely to match
  // somewhere by coincidence, which would pin a wrong speaker and timecode
  // onto it. Reject rather than guess.
  if (needle.length < 16 || needle.split(' ').length < 4) {
    return { ok: false, reason: 'too short to verify' }
  }

  const at = index.text.indexOf(needle)
  if (at < 0) {
    // Say *where* it diverged. A quote that matches 20 words then stops is the
    // model running two nearby passages together; one that matches 3 is an
    // invention. Those are different problems and a bare "not found" hides
    // which one you have.
    const words = needle.split(' ')
    let matched = 0
    for (let k = words.length; k > 0; k--) {
      if (index.text.includes(words.slice(0, k).join(' '))) { matched = k; break }
    }
    const detail = matched === 0
      ? 'no part of it is in the transcript'
      : `matched ${matched}/${words.length} words, then diverged at "…${words.slice(Math.max(0, matched - 4), matched + 4).join(' ')}…"`
    return { ok: false, reason: `not in transcript — ${detail}` }
  }
  if (index.text.indexOf(needle, at + 1) >= 0) {
    // Ambiguous placement — a repeated catchphrase. Keep the quote, but don't
    // claim a timecode we can't pin down.
    const cue = index.cues[index.cueAt[at]]
    return { ok: true, quote, speaker: cue.speaker || null, timecode: null }
  }

  const startCue = index.cueAt[at]
  const endCue = index.cueAt[Math.min(at + needle.length - 1, index.cueAt.length - 1)]
  const speakers = new Set<string>()
  for (let i = startCue; i <= endCue; i++) speakers.add(index.cues[i].speaker)
  if (speakers.size > 1) {
    return { ok: false, reason: `spans a speaker change (${[...speakers].join(' → ')})` }
  }

  const cue = index.cues[startCue]
  return {
    ok: true,
    quote,
    speaker: cue.speaker || null,
    timecode: formatTimecode(cue.t),
  }
}

// ---------------------------------------------------------------------------
// Quota
// ---------------------------------------------------------------------------

/**
 * At least 2 candidates per episode, otherwise ~3 per hour of audio.
 *
 * Duration comes from the transcript's last cue when the episode row has no
 * audio_duration_seconds — most of the back catalogue doesn't, and the last
 * timestamp tracks the real runtime closely enough for a quota.
 */
export function quoteTarget(durationSeconds: number): number {
  const hours = durationSeconds / 3600
  return Math.max(2, Math.round(3 * hours))
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const QuotesSchema = z.object({
  quotes: z.array(
    z.object({
      quote: z
        .string()
        .describe('The line, copied from the transcript. Punctuation and capitalization may be corrected; the words may not be changed.'),
      why: z
        .string()
        .describe('One short line on why this one lands. Read by a human picking between candidates; not stored.'),
    }),
  ),
})

const SYSTEM_PROMPT = `
You pick pull quotes from podcast transcripts. A pull quote is a short line
lifted from the episode and shown on its own — on a social card, or as a callout
on the episode page. It has to work with no surrounding context.

You will be given a show brief and a transcript. The transcript is automatic
speech recognition output: lowercase, lightly punctuated, and sentences often
run across cue boundaries. Cue lines are numbered and marked with a timecode and
the speaker.

Rules:
- A quote must be ONE CONTINUOUS RUN of words from the transcript — every word
  from where it starts to where it ends, in order, with nothing removed.
- You may fix capitalization and add punctuation so the line reads cleanly.
  That is the only editing allowed.
- Do NOT delete words from the middle to tighten a quote. Cutting a sentence out
  of the middle fails the check even though every word you kept appears in the
  transcript. If the good part is buried in a rambling passage, start the quote
  later or end it earlier — never cut the middle out.
- Do not paraphrase, compress, reorder, or add words. Every quote is checked
  against the transcript and an edited one is thrown away.
- One speaker per quote. Never stitch a line together across a speaker change,
  even where the transcript reads continuously.
- Aim for roughly 8 to 40 words. A quote that needs three sentences of setup is
  the wrong quote.
- No two quotes from the same moment; spread them across the episode.
- Ignore intros, outros, sponsor reads, and housekeeping.
- Rank them strongest first. Only the top few that pass the verbatim check are
  kept, so a ranked list of solid candidates is more useful than a short list.
- Still, only include quotes that genuinely earn their place. A padded list of
  weak ones helps nobody — but the floor is a real floor, so find at least the
  minimum unless the transcript is unusable.
`.trim()

function buildTranscriptBlock(cues: Cue[]): string {
  return cues
    .map((c, i) => `[${i}] ${formatTimecode(c.t)} ${c.speaker || 'UNKNOWN'}: ${c.text}`)
    .join('\n')
}

interface Candidate {
  quote: string
  why: string
  speaker: string | null
  timecode: string | null
}

async function generateForEpisode(
  client: Anthropic,
  model: string,
  brief: string,
  episode: EpisodeRow,
  cues: Cue[],
  target: number,
): Promise<{ candidates: Candidate[]; rejected: string[] }> {
  const index = buildIndex(cues)
  // Ask for more than we need. Rejections land anywhere in the ranking, so
  // without margin a couple of edited quotes drop the episode below its quota
  // and the only fix is another full-transcript round trip.
  const ask = target + Math.max(2, Math.ceil(target * 0.6))

  const response = await client.messages.parse({
    model,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    thinking: { type: 'adaptive' },
    messages: [
      {
        role: 'user',
        content: [
          '# Show brief',
          '',
          brief,
          '',
          `# Episode: ${episode.title || episode.slug}`,
          '',
          `Return your ${ask} best pull quotes, strongest first. The top ${target} that`,
          `pass the verbatim check are the ones that get used, so the extras are`,
          `insurance against a rejection — not permission to pad.`,
          '',
          '# Transcript',
          '',
          buildTranscriptBlock(cues),
        ].join('\n'),
      },
    ],
    output_config: { format: zodOutputFormat(QuotesSchema) },
  })

  if (response.stop_reason === 'refusal') {
    throw new Error(`model declined: ${response.stop_details?.explanation || 'no explanation'}`)
  }
  const parsed = response.parsed_output
  if (!parsed) throw new Error('model returned no parseable output')

  const candidates: Candidate[] = []
  const rejected: string[] = []
  const seen = new Set<string>()

  for (const raw of parsed.quotes) {
    const check = verify(index, raw.quote)
    if (!check.ok) {
      rejected.push(`${check.reason}\n      quote: "${raw.quote}"`)
      continue
    }
    const key = normalize(check.quote)
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({
      quote: check.quote,
      why: raw.why,
      speaker: check.speaker,
      timecode: check.timecode,
    })
  }

  return { candidates: candidates.slice(0, target), rejected }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function fetchTranscript(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': 'podshelf-pull-quotes/1.0' } })
  if (!res.ok) throw new Error(`transcript fetch failed: HTTP ${res.status}`)
  return res.text()
}

/** Runs `worker` over `items` with at most `limit` in flight, preserving order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await worker(items[i], i)
    }
  })
  await Promise.all(runners)
  return results
}

interface EpisodeOutcome {
  episode: EpisodeRow
  status: 'imported' | 'dry-run' | 'skipped' | 'failed'
  detail: string
  candidates: Candidate[]
  rejected: string[]
}

async function main() {
  loadEnv()
  const opts = parseArgs(process.argv.slice(2))

  const apiKey = process.env.PODSHELF_API_KEY
  if (!apiKey) {
    console.error('PODSHELF_API_KEY is required (put it in .env or the environment).')
    process.exit(1)
  }
  const base = (process.env.PODSHELF_URL || 'https://podshelf.hennemo.com').replace(/\/+$/, '')

  const brief = opts.brief ?? SHOW_BRIEFS[opts.podcast]
  if (!brief) {
    console.error(
      `No brief for "${opts.podcast}". What makes a good pull quote differs per show, so\n` +
      `there's no generic default. Add one to SHOW_BRIEFS in this script, or pass --brief.\n` +
      `Known shows: ${Object.keys(SHOW_BRIEFS).join(', ')}`,
    )
    process.exit(1)
  }

  const api = new Podshelf(base, apiKey, opts.podcast)

  // Constructed up front so a missing credential fails before we spend time
  // walking the catalogue. The SDK also accepts an `ant auth login` profile, so
  // don't test for ANTHROPIC_API_KEY directly — let it resolve, and translate
  // its failure into something actionable.
  let anthropic: Anthropic
  try {
    anthropic = new Anthropic()
  } catch {
    console.error(
      'No Anthropic credential found. Set ANTHROPIC_API_KEY (env or .env), or run `ant auth login`.',
    )
    process.exit(1)
  }

  console.log(`Podshelf: ${base}  ·  podcast: ${opts.podcast}  ·  model: ${opts.model}`)

  const all = await api.listEpisodes()
  let candidates = all.filter((e) => e.transcript_path)
  const noTranscript = all.length - candidates.length

  if (opts.episodes.length > 0) {
    const wanted = new Set(opts.episodes)
    candidates = candidates.filter((e) => wanted.has(e.id))
    const missing = opts.episodes.filter((id) => !candidates.some((e) => e.id === id))
    if (missing.length > 0) {
      console.warn(`  warning: no transcript for episode id(s) ${missing.join(', ')}`)
    }
  }

  console.log(
    `${all.length} episodes, ${candidates.length} with a transcript` +
    (noTranscript ? ` (${noTranscript} without — nothing to do for those)` : ''),
  )

  // Gap-fill: drop anything that already has quotes unless --force. Done up
  // front so the run plan (and the --limit budget) reflects real work.
  const planned: EpisodeRow[] = []
  const skipped: EpisodeOutcome[] = []
  for (const ep of candidates) {
    const existing = await api.listPullQuotes(ep.id)
    if (existing.length > 0 && !opts.force) {
      skipped.push({
        episode: ep,
        status: 'skipped',
        detail: `already has ${existing.length} quote${existing.length === 1 ? '' : 's'} (--force to regenerate)`,
        candidates: [],
        rejected: [],
      })
      continue
    }
    planned.push(ep)
  }

  const work = opts.limit == null ? planned : planned.slice(0, opts.limit)
  console.log(
    `${work.length} to process, ${skipped.length} skipped` +
    (opts.limit != null && planned.length > work.length ? ` (--limit ${opts.limit} of ${planned.length})` : '') +
    (opts.dryRun ? '  ·  DRY RUN, nothing will be written' : ''),
  )
  if (work.length === 0) {
    printSummary(skipped, opts)
    return
  }

  const outcomes = await mapWithConcurrency(work, opts.concurrency, async (ep): Promise<EpisodeOutcome> => {
    const label = `#${ep.id} ${ep.slug}`
    try {
      const raw = await fetchTranscript(ep.transcript_path!)
      const cues = parseCues(raw, ep.transcript_type, ep.transcript_path!)
      if (cues.length === 0) throw new Error('transcript parsed to zero cues')

      // The row's duration is authoritative when present; most of the back
      // catalogue has none, so fall back to the last cue's timestamp.
      const lastCue = cues[cues.length - 1].t
      const duration = Math.max(ep.audio_duration_seconds || 0, lastCue)
      const target = quoteTarget(duration)

      console.log(`  ${label}: ${cues.length} cues, ${formatTimecode(duration)} → asking for ${target}`)

      const { candidates: got, rejected } = await generateForEpisode(
        anthropic, opts.model, brief, ep, cues, target,
      )

      if (got.length === 0) {
        return { episode: ep, status: 'failed', detail: 'no quote survived verification', candidates: [], rejected }
      }
      if (opts.dryRun) {
        return { episode: ep, status: 'dry-run', detail: `${got.length} candidate(s)`, candidates: got, rejected }
      }

      const result = await api.importPullQuotes(
        ep.id,
        got.map((c) => ({ quote: c.quote, speaker: c.speaker, timecode: c.timecode })),
      )
      return {
        episode: ep,
        status: 'imported',
        detail: `${result.added} added${result.removed ? `, ${result.removed} replaced` : ''}`,
        candidates: got,
        rejected,
      }
    } catch (err) {
      return {
        episode: ep,
        status: 'failed',
        detail: err instanceof Error ? err.message : String(err),
        candidates: [],
        rejected: [],
      }
    }
  })

  printSummary([...outcomes, ...skipped], opts)

  if (outcomes.some((o) => o.status === 'failed')) process.exitCode = 1
}

function printSummary(outcomes: EpisodeOutcome[], opts: Options) {
  console.log('\n' + '─'.repeat(72))
  for (const o of outcomes) {
    if (o.status === 'skipped') continue
    const title = o.episode.title || o.episode.slug
    console.log(`\n#${o.episode.id} ${title} — ${o.status}: ${o.detail}`)
    for (const c of o.candidates) {
      const meta = [c.speaker, c.timecode].filter(Boolean).join(' @ ') || 'unattributed'
      console.log(`  · [${meta}] ${c.quote}`)
      if (opts.dryRun) console.log(`      ↳ ${c.why}`)
    }
    for (const r of o.rejected) console.log(`  ✗ dropped — ${r}`)
  }

  const counts = { imported: 0, 'dry-run': 0, skipped: 0, failed: 0 }
  let quotes = 0
  for (const o of outcomes) {
    counts[o.status]++
    quotes += o.candidates.length
  }
  console.log('\n' + '─'.repeat(72))
  console.log(
    `${counts.imported} imported · ${counts['dry-run']} dry-run · ` +
    `${counts.skipped} skipped · ${counts.failed} failed · ${quotes} quotes total`,
  )
  if (counts.imported > 0) {
    console.log('Curate them in the episode editor — these are candidates, not a final list.')
  }
}

// Only run the CLI when this file *is* the process entry point. The pure
// helpers above (parseCues, quoteTarget, verify) are imported by the test
// suite, and an unguarded main() would fire the argument parser on import.
function isEntryPoint(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack || err.message : String(err))
    process.exit(1)
  })
}
