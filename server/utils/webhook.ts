import { createError } from 'h3'
import { encryptString, decryptString } from './crypto'
import { assertPublicHttpUrl } from './ssrf'
import getDb from '../db/index'

export type WebhookFormat = 'discord' | 'slack' | 'generic'

// Cap on outbound webhook delivery. firePublishEvent is awaited on the publish
// request path, so without this a webhook host that accepts the connection and
// stalls would hold the user's publish open until undici's ~300s header timeout.
// On abort, fetch throws and the send functions' catch returns { ok: false }.
const WEBHOOK_TIMEOUT_MS = 10_000

export const WEBHOOK_EVENTS = [
  'episode.publish',
  'episode.recording.scheduled',
  'episode.recording.moved',
  'episode.recording.cancelled',
  'correction.submitted',
] as const
export type WebhookEvent = typeof WEBHOOK_EVENTS[number]

export function isWebhookEvent(x: unknown): x is WebhookEvent {
  return typeof x === 'string' && (WEBHOOK_EVENTS as readonly string[]).includes(x)
}

export function isWebhookFormat(x: unknown): x is WebhookFormat {
  return x === 'discord' || x === 'slack' || x === 'generic'
}

/**
 * Stripped-down send shape — what the body builders need. A full DB row
 * (WebhookRow) extends this with id/scope/name/events.
 */
export interface WebhookConfig {
  url: string
  format: WebhookFormat
  enabled: boolean
}

export interface WebhookRow extends WebhookConfig {
  id: number
  podcast_id: number | null
  network_id: number | null
  name: string
  events: WebhookEvent[]
}

export interface WebhookSummary {
  id: number
  scope: 'podcast' | 'network'
  scope_id: number
  name: string
  format: WebhookFormat
  enabled: boolean
  events: WebhookEvent[]
  url_host: string | null
  created_at: string
  updated_at: string
}

interface RawWebhookRow {
  id: number
  podcast_id: number | null
  network_id: number | null
  name: string
  url_encrypted: string
  format: string
  enabled: number
  events: string
  created_at: string
  updated_at: string
}

function parseEvents(json: string): WebhookEvent[] {
  try {
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isWebhookEvent)
  } catch {
    return []
  }
}

function decryptUrl(encrypted: string): string | null {
  try {
    return decryptString(encrypted)
  } catch {
    return null
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

function rowToSummary(r: RawWebhookRow): WebhookSummary {
  const url = decryptUrl(r.url_encrypted)
  return {
    id: r.id,
    scope: r.podcast_id !== null ? 'podcast' : 'network',
    scope_id: r.podcast_id !== null ? r.podcast_id : (r.network_id as number),
    name: r.name,
    format: isWebhookFormat(r.format) ? r.format : 'generic',
    enabled: !!r.enabled,
    events: parseEvents(r.events),
    url_host: url ? hostOf(url) : null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

function rowToFull(r: RawWebhookRow): WebhookRow | null {
  const url = decryptUrl(r.url_encrypted)
  if (!url) return null
  return {
    id: r.id,
    podcast_id: r.podcast_id,
    network_id: r.network_id,
    name: r.name,
    url,
    format: isWebhookFormat(r.format) ? r.format : 'generic',
    enabled: !!r.enabled,
    events: parseEvents(r.events),
  }
}

export function listPodcastWebhooks(podcastId: number): WebhookSummary[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT id, podcast_id, network_id, name, url_encrypted, format, enabled,
           events, created_at, updated_at
    FROM webhooks
    WHERE podcast_id = ?
    ORDER BY id
  `).all(podcastId) as RawWebhookRow[]
  return rows.map(rowToSummary)
}

export function listNetworkWebhooks(networkId: number): WebhookSummary[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT id, podcast_id, network_id, name, url_encrypted, format, enabled,
           events, created_at, updated_at
    FROM webhooks
    WHERE network_id = ?
    ORDER BY id
  `).all(networkId) as RawWebhookRow[]
  return rows.map(rowToSummary)
}

export function getWebhookSummary(id: number): WebhookSummary | null {
  const db = getDb()
  const row = db.prepare(`
    SELECT id, podcast_id, network_id, name, url_encrypted, format, enabled,
           events, created_at, updated_at
    FROM webhooks WHERE id = ?
  `).get(id) as RawWebhookRow | undefined
  return row ? rowToSummary(row) : null
}

export function getWebhookFull(id: number): WebhookRow | null {
  const db = getDb()
  const row = db.prepare(`
    SELECT id, podcast_id, network_id, name, url_encrypted, format, enabled,
           events, created_at, updated_at
    FROM webhooks WHERE id = ?
  `).get(id) as RawWebhookRow | undefined
  return row ? rowToFull(row) : null
}

export interface CreateWebhookInput {
  name?: string
  url: string
  format: WebhookFormat
  enabled?: boolean
  events: WebhookEvent[]
}

/**
 * Discord and Slack webhook endpoints reject the `generic` JSON payload —
 * Discord with "Cannot send an empty message" (50006), Slack with "no_text" —
 * because that payload doesn't include the platform-required `content` /
 * `embeds` / `text` fields. Catch the format/URL mismatch at write time so a
 * misconfigured webhook can't silently fail at fire time.
 */
export function assertFormatMatchesUrl(url: string, format: WebhookFormat): void {
  let host: string
  try {
    host = new URL(url).host.toLowerCase()
  } catch {
    // Bad URLs are rejected upstream by the endpoint validators.
    return
  }
  const isDiscord =
    host === 'discord.com' ||
    host === 'discordapp.com' ||
    host === 'ptb.discord.com' ||
    host === 'canary.discord.com'
  const isSlack = host === 'hooks.slack.com'
  if (isDiscord && format !== 'discord') {
    throw createError({
      statusCode: 400,
      statusMessage: `Discord webhook URL must use format='discord' (got '${format}'). The generic payload is rejected by Discord.`,
    })
  }
  if (isSlack && format !== 'slack') {
    throw createError({
      statusCode: 400,
      statusMessage: `Slack webhook URL must use format='slack' (got '${format}'). The generic payload is rejected by Slack.`,
    })
  }
}

function sanitizeEvents(events: WebhookEvent[]): WebhookEvent[] {
  const seen = new Set<WebhookEvent>()
  const out: WebhookEvent[] = []
  for (const e of events) {
    if (!seen.has(e)) {
      seen.add(e)
      out.push(e)
    }
  }
  return out
}

function insertWebhook(
  scopeColumn: 'podcast_id' | 'network_id',
  scopeId: number,
  input: CreateWebhookInput,
): number {
  const trimmedUrl = input.url.trim()
  assertFormatMatchesUrl(trimmedUrl, input.format)
  const db = getDb()
  const result = db.prepare(`
    INSERT INTO webhooks (${scopeColumn}, name, url_encrypted, format, enabled, events)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    scopeId,
    (input.name ?? '').trim(),
    encryptString(trimmedUrl),
    input.format,
    input.enabled === false ? 0 : 1,
    JSON.stringify(sanitizeEvents(input.events)),
  )
  return Number(result.lastInsertRowid)
}

export function createPodcastWebhook(podcastId: number, input: CreateWebhookInput): number {
  return insertWebhook('podcast_id', podcastId, input)
}

export function createNetworkWebhook(networkId: number, input: CreateWebhookInput): number {
  return insertWebhook('network_id', networkId, input)
}

export interface UpdateWebhookInput {
  name?: string
  url?: string
  format?: WebhookFormat
  enabled?: boolean
  events?: WebhookEvent[]
}

export function updateWebhook(id: number, input: UpdateWebhookInput): void {
  const db = getDb()

  // When either url or format is changing, validate the resulting pair so a
  // partial update can't sneak a Discord URL into a generic-format row (or
  // vice versa). Load the current row only when one side is being patched.
  const newUrl = typeof input.url === 'string' ? input.url.trim() : undefined
  const newFormat = input.format
  if (newUrl || newFormat) {
    const existing = getWebhookFull(id)
    const effectiveUrl = newUrl && newUrl.length > 0 ? newUrl : existing?.url
    const effectiveFormat = newFormat ?? existing?.format
    if (effectiveUrl && effectiveFormat) {
      assertFormatMatchesUrl(effectiveUrl, effectiveFormat)
    }
  }

  const updates: string[] = []
  const params: (string | number | null)[] = []
  if (typeof input.name === 'string') {
    updates.push('name = ?')
    params.push(input.name.trim())
  }
  if (typeof input.url === 'string') {
    const trimmed = input.url.trim()
    if (!trimmed) return // empty URL means "no change" — caller should validate up front
    updates.push('url_encrypted = ?')
    params.push(encryptString(trimmed))
  }
  if (input.format !== undefined) {
    updates.push('format = ?')
    params.push(input.format)
  }
  if (input.enabled !== undefined) {
    updates.push('enabled = ?')
    params.push(input.enabled ? 1 : 0)
  }
  if (input.events !== undefined) {
    updates.push('events = ?')
    params.push(JSON.stringify(sanitizeEvents(input.events)))
  }
  if (updates.length === 0) return
  updates.push("updated_at = datetime('now')")
  params.push(id)
  db.prepare(`UPDATE webhooks SET ${updates.join(', ')} WHERE id = ?`).run(...params)
}

export function deleteWebhook(id: number): void {
  const db = getDb()
  db.prepare('DELETE FROM webhooks WHERE id = ?').run(id)
}

/**
 * Every webhook (enabled + subscribed to `event`) that should fire for this
 * podcast. Pulls both the podcast's own webhooks and any network webhooks
 * attached to a network the podcast belongs to.
 */
export function loadWebhooksForEvent(podcastId: number, event: WebhookEvent): WebhookRow[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT w.id, w.podcast_id, w.network_id, w.name, w.url_encrypted,
           w.format, w.enabled, w.events, w.created_at, w.updated_at
    FROM webhooks w
    WHERE w.enabled = 1
      AND (
        w.podcast_id = ?
        OR w.network_id IN (
          SELECT network_id FROM network_podcasts WHERE podcast_id = ?
        )
      )
  `).all(podcastId, podcastId) as RawWebhookRow[]
  const out: WebhookRow[] = []
  for (const r of rows) {
    const events = parseEvents(r.events)
    if (!events.includes(event)) continue
    const full = rowToFull(r)
    if (full) out.push(full)
  }
  return out
}

export interface WebhookEpisodePayload {
  title: string
  description: string | null
  episode_url: string
  audio_url: string | null
  image_url: string | null
  episode_number: number | null
  season_number: number | null
  published_at: string | null
}

export type RecordingChangeKind = 'scheduled' | 'moved' | 'cancelled'

export interface WebhookRecordingPayload {
  kind: RecordingChangeKind
  episode_title: string
  episode_url: string
  episode_number: number | null
  season_number: number | null
  // Always UTC ISO; the formatter renders in the podcast's timezone for
  // the chat-readable string but keeps the raw ISO in the generic payload.
  new_starts_at: string | null
  new_duration_minutes: number | null
  previous_starts_at: string | null
  previous_duration_minutes: number | null
  // IANA name used for the human-readable date/time in messages.
  podcast_timezone: string
}

export interface WebhookPodcastPayload {
  slug: string
  title: string
  feed_url: string
  website: string | null
}

export interface WebhookCorrectionPayload {
  correction_id: number
  // Null when the submitter didn't pick an episode. The slug is kept even
  // when the episode row can't be resolved, so the message still says what
  // the listener was talking about.
  episode_title: string | null
  episode_slug: string | null
  episode_url: string | null
  timecode: string | null
  claim: string
  correction: string
  source_url: string | null
  submitter_name: string | null
  submitter_contact: string | null
  triage_url: string
}

function buildBody(
  config: WebhookConfig,
  podcast: WebhookPodcastPayload,
  episode: WebhookEpisodePayload,
): { body: string; contentType: string } {
  if (config.format === 'discord') {
    const lines: string[] = []
    if (episode.season_number || episode.episode_number) {
      const parts: string[] = []
      if (episode.season_number) parts.push(`Season ${episode.season_number}`)
      if (episode.episode_number) parts.push(`Episode ${episode.episode_number}`)
      lines.push(parts.join(' · '))
    }
    if (episode.description) {
      // Strip HTML tags for chat-friendly preview, keep first 280 chars.
      const stripped = episode.description.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
      lines.push(stripped.length > 280 ? stripped.slice(0, 280) + '…' : stripped)
    }
    const embed: Record<string, unknown> = {
      title: episode.title,
      url: episode.episode_url,
      description: lines.join('\n\n') || undefined,
      author: { name: podcast.title, url: podcast.website || podcast.feed_url },
    }
    if (episode.image_url) embed.thumbnail = { url: episode.image_url }
    return {
      body: JSON.stringify({
        content: `New episode of **${podcast.title}**`,
        embeds: [embed],
      }),
      contentType: 'application/json',
    }
  }

  if (config.format === 'slack') {
    const blocks: unknown[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*New episode of <${podcast.website || podcast.feed_url}|${podcast.title}>*\n<${episode.episode_url}|${episode.title}>`,
        },
      },
    ]
    if (episode.description) {
      const stripped = episode.description.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
      const trimmed = stripped.length > 280 ? stripped.slice(0, 280) + '…' : stripped
      if (trimmed) {
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: trimmed },
        })
      }
    }
    return {
      body: JSON.stringify({
        text: `New episode of ${podcast.title}: ${episode.title}`,
        blocks,
      }),
      contentType: 'application/json',
    }
  }

  // generic
  return {
    body: JSON.stringify({
      event: 'episode.publish',
      podcast,
      episode,
      fired_at: new Date().toISOString(),
    }),
    contentType: 'application/json',
  }
}

function formatRecordingMoment(iso: string | null, tz: string): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: tz,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    })
  } catch {
    return iso
  }
}

function recordingEpisodeLabel(p: WebhookRecordingPayload): string {
  if (p.season_number && p.episode_number) return `S${p.season_number}E${p.episode_number}: ${p.episode_title}`
  if (p.episode_number) return `E${p.episode_number}: ${p.episode_title}`
  return p.episode_title
}

function buildRecordingHeadline(p: WebhookRecordingPayload): string {
  const label = recordingEpisodeLabel(p)
  const newWhen = formatRecordingMoment(p.new_starts_at, p.podcast_timezone)
  const prevWhen = formatRecordingMoment(p.previous_starts_at, p.podcast_timezone)
  const durStr = (m: number | null) => (m ? ` (${m} min)` : '')
  if (p.kind === 'scheduled') {
    return `Recording scheduled for ${label} — ${newWhen}${durStr(p.new_duration_minutes)}`
  }
  if (p.kind === 'moved') {
    return `Recording moved for ${label} — now ${newWhen}${durStr(p.new_duration_minutes)} (was ${prevWhen || 'unscheduled'})`
  }
  return `Recording cancelled for ${label}${prevWhen ? ` — was ${prevWhen}` : ''}`
}

function buildRecordingBody(
  config: WebhookConfig,
  podcast: WebhookPodcastPayload,
  rec: WebhookRecordingPayload,
): { body: string; contentType: string } {
  const headline = buildRecordingHeadline(rec)
  if (config.format === 'discord') {
    const embed: Record<string, unknown> = {
      title: rec.episode_title,
      url: rec.episode_url,
      description: headline,
      author: { name: podcast.title, url: podcast.website || podcast.feed_url },
    }
    return {
      body: JSON.stringify({
        content: `📅 ${headline}`,
        embeds: [embed],
      }),
      contentType: 'application/json',
    }
  }
  if (config.format === 'slack') {
    return {
      body: JSON.stringify({
        text: headline,
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*${headline}*\n<${rec.episode_url}|Open episode>` },
          },
        ],
      }),
      contentType: 'application/json',
    }
  }
  // generic
  return {
    body: JSON.stringify({
      event: `episode.recording.${rec.kind}`,
      podcast,
      recording: rec,
      headline,
      fired_at: new Date().toISOString(),
    }),
    contentType: 'application/json',
  }
}

/** Same shape + non-throwing contract as sendPublishWebhook. */
export async function sendRecordingWebhook(
  config: WebhookConfig,
  podcast: WebhookPodcastPayload,
  rec: WebhookRecordingPayload,
): Promise<{ ok: boolean; status?: number; message?: string }> {
  try {
    await assertPublicHttpUrl(config.url)
    const { body, contentType } = buildRecordingBody(config, podcast, rec)
    const res = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, status: res.status, message: text.slice(0, 200) || res.statusText }
    }
    return { ok: true, status: res.status }
  } catch (err: unknown) {
    return { ok: false, message: err instanceof Error ? err.message : 'webhook failed' }
  }
}

/**
 * Send the webhook for a publish event. Returns { ok, status, message? }.
 * Never throws — webhook failures should not break the publish flow.
 */
export async function sendPublishWebhook(
  config: WebhookConfig,
  podcast: WebhookPodcastPayload,
  episode: WebhookEpisodePayload,
): Promise<{ ok: boolean; status?: number; message?: string }> {
  try {
    await assertPublicHttpUrl(config.url)
    const { body, contentType } = buildBody(config, podcast, episode)
    const res = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, status: res.status, message: text.slice(0, 200) || res.statusText }
    }
    return { ok: true, status: res.status }
  } catch (err: unknown) {
    return { ok: false, message: err instanceof Error ? err.message : 'webhook failed' }
  }
}

function correctionEpisodeLabel(c: WebhookCorrectionPayload): string {
  if (c.episode_title) return c.episode_title
  if (c.episode_slug) return c.episode_slug
  return 'the show (no episode specified)'
}

/**
 * Correction submissions come from the open internet, so every field here is
 * attacker-controlled. Truncate hard and — for the chat formats — neutralize
 * the characters that would otherwise let a submitter forge markdown, fake a
 * link, or inject an @everyone into the host's Discord channel.
 */
function chatSafe(s: string, max: number): string {
  const trimmed = s.replace(/\s+/g, ' ').trim()
  const capped = trimmed.length > max ? trimmed.slice(0, max) + '…' : trimmed
  return capped
    .replace(/[*_~`|>]/g, (m) => '\\' + m)
    .replace(/@(everyone|here)/gi, '@​$1')
}

/** Exported for shape-pinning tests; callers should use sendCorrectionWebhook. */
export function buildCorrectionBody(
  config: WebhookConfig,
  podcast: WebhookPodcastPayload,
  c: WebhookCorrectionPayload,
): { body: string; contentType: string } {
  const label = correctionEpisodeLabel(c)
  const where = c.timecode ? `${label} @ ${c.timecode}` : label
  const who = c.submitter_name ? chatSafe(c.submitter_name, 80) : 'Anonymous'

  if (config.format === 'discord') {
    const fields: Record<string, unknown>[] = [
      { name: 'We said', value: chatSafe(c.claim, 900) || '—' },
      { name: "What's actually true", value: chatSafe(c.correction, 900) || '—' },
    ]
    if (c.source_url) fields.push({ name: 'Source', value: c.source_url })
    if (c.submitter_contact) {
      fields.push({ name: 'Contact', value: chatSafe(c.submitter_contact, 120) })
    }
    const embed: Record<string, unknown> = {
      title: `Correction on ${where}`.slice(0, 250),
      url: c.triage_url,
      description: `Submitted by ${who}`,
      fields,
      author: { name: podcast.title, url: podcast.website || podcast.feed_url },
    }
    return {
      body: JSON.stringify({
        content: `📝 Correction submitted for **${chatSafe(podcast.title, 100)}**`,
        embeds: [embed],
      }),
      contentType: 'application/json',
    }
  }

  if (config.format === 'slack') {
    const lines = [
      `*Correction submitted for ${podcast.title}*`,
      `_${where}_ — from ${who}`,
      `*We said:* ${chatSafe(c.claim, 900)}`,
      `*Actually:* ${chatSafe(c.correction, 900)}`,
    ]
    if (c.source_url) lines.push(`*Source:* ${c.source_url}`)
    lines.push(`<${c.triage_url}|Triage in Podshelf>`)
    const text = lines.join('\n')
    return {
      body: JSON.stringify({
        text: `Correction submitted for ${podcast.title}`,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }],
      }),
      contentType: 'application/json',
    }
  }

  // generic
  return {
    body: JSON.stringify({
      event: 'correction.submitted',
      podcast,
      correction: c,
      fired_at: new Date().toISOString(),
    }),
    contentType: 'application/json',
  }
}

/** Same shape + non-throwing contract as sendPublishWebhook. */
export async function sendCorrectionWebhook(
  config: WebhookConfig,
  podcast: WebhookPodcastPayload,
  correction: WebhookCorrectionPayload,
): Promise<{ ok: boolean; status?: number; message?: string }> {
  try {
    await assertPublicHttpUrl(config.url)
    const { body, contentType } = buildCorrectionBody(config, podcast, correction)
    const res = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, status: res.status, message: text.slice(0, 200) || res.statusText }
    }
    return { ok: true, status: res.status }
  } catch (err: unknown) {
    return { ok: false, message: err instanceof Error ? err.message : 'webhook failed' }
  }
}
