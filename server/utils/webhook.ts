import { encryptString, decryptString } from './crypto'
import getDb from '../db/index'

export type WebhookFormat = 'discord' | 'slack' | 'generic'

export interface WebhookConfig {
  url: string
  format: WebhookFormat
  enabled: boolean
}

export interface WebhookConfigDescription {
  has_url: boolean
  format: WebhookFormat
  enabled: boolean
  /** Just the host, e.g. "discord.com" — useful as a hint without leaking the token. */
  url_host: string | null
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

function loadConfig(podcastId: number): WebhookConfig | null {
  const db = getDb()
  const row = db.prepare(`
    SELECT webhook_url_encrypted, webhook_format, webhook_enabled
    FROM podcasts WHERE id = ?
  `).get(podcastId) as {
    webhook_url_encrypted: string | null
    webhook_format: string
    webhook_enabled: number
  } | undefined
  if (!row || !row.webhook_url_encrypted) return null
  let url: string
  try {
    url = decryptString(row.webhook_url_encrypted)
  } catch {
    return null
  }
  const format = (row.webhook_format === 'discord' || row.webhook_format === 'slack')
    ? row.webhook_format
    : 'generic'
  return { url, format, enabled: !!row.webhook_enabled }
}

export function loadWebhookConfig(podcastId: number): WebhookConfig | null {
  return loadConfig(podcastId)
}

export function describeWebhookConfig(podcastId: number): WebhookConfigDescription {
  const db = getDb()
  const row = db.prepare(`
    SELECT webhook_url_encrypted, webhook_format, webhook_enabled
    FROM podcasts WHERE id = ?
  `).get(podcastId) as {
    webhook_url_encrypted: string | null
    webhook_format: string
    webhook_enabled: number
  } | undefined

  if (!row) {
    return { has_url: false, format: 'generic', enabled: false, url_host: null }
  }

  let urlHost: string | null = null
  if (row.webhook_url_encrypted) {
    try {
      const url = decryptString(row.webhook_url_encrypted)
      urlHost = new URL(url).host
    } catch {
      urlHost = null
    }
  }

  const format = (row.webhook_format === 'discord' || row.webhook_format === 'slack')
    ? row.webhook_format as WebhookFormat
    : 'generic'

  return {
    has_url: !!row.webhook_url_encrypted,
    format,
    enabled: !!row.webhook_enabled,
    url_host: urlHost,
  }
}

export interface SaveWebhookInput {
  url?: string
  format: WebhookFormat
  enabled: boolean
}

export function saveWebhookConfig(podcastId: number, input: SaveWebhookInput) {
  const db = getDb()
  const updates: string[] = ['webhook_format = ?', 'webhook_enabled = ?', "updated_at = datetime('now')"]
  const params: (string | number | null)[] = [input.format, input.enabled ? 1 : 0]

  if (typeof input.url === 'string') {
    if (input.url.trim()) {
      updates.unshift('webhook_url_encrypted = ?')
      params.unshift(encryptString(input.url.trim()))
    } else {
      updates.unshift('webhook_url_encrypted = NULL')
    }
  }

  params.push(podcastId)
  db.prepare(`UPDATE podcasts SET ${updates.join(', ')} WHERE id = ?`).run(...params)
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
    const { body, contentType } = buildRecordingBody(config, podcast, rec)
    const res = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
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
    const { body, contentType } = buildBody(config, podcast, episode)
    const res = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
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
