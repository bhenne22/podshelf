import { defineEventHandler, getRouterParam, setHeader } from 'h3'
import { requirePodcastAccess } from '../../../utils/auth'
import getDb from '../../../db/index'

/**
 * GET /api/podcasts/[slug]/audit.csv
 *
 * Streams the full audit log for the podcast as CSV. Newest first, no
 * pagination — operators want a single download for archive / spreadsheet
 * inspection. RFC 4180 quoting (double-quote any field, escape embedded
 * quotes by doubling them).
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)

  const db = getDb()
  const rows = db.prepare(`
    SELECT a.id, a.created_at, a.action, a.entity_type, a.entity_id,
           a.summary, a.details, a.user_id, a.api_key_id,
           u.email AS user_email,
           k.label AS api_key_label
    FROM audit_log a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN api_keys k ON k.id = a.api_key_id
    WHERE a.podcast_id = ?
    ORDER BY a.id DESC
  `).all(podcastId) as Array<{
    id: number
    created_at: string
    action: string
    entity_type: string | null
    entity_id: number | null
    summary: string | null
    details: string | null
    user_id: number | null
    api_key_id: number | null
    user_email: string | null
    api_key_label: string | null
  }>

  const header = [
    'id', 'created_at', 'action', 'entity_type', 'entity_id',
    'actor_type', 'actor_label', 'user_email', 'api_key_id', 'api_key_label',
    'summary', 'details_json',
  ]

  const lines = [header.join(',')]
  for (const r of rows) {
    const actorType = r.api_key_id ? 'api_key' : (r.user_id ? 'user' : 'system')
    const actorLabel = r.api_key_id
      ? (r.api_key_label || `key #${r.api_key_id}`)
      : (r.user_email || 'system')
    lines.push([
      r.id,
      r.created_at,
      r.action,
      r.entity_type ?? '',
      r.entity_id ?? '',
      actorType,
      actorLabel,
      r.user_email ?? '',
      r.api_key_id ?? '',
      r.api_key_label ?? '',
      r.summary ?? '',
      r.details ?? '',
    ].map(csvCell).join(','))
  }

  const filename = `audit-${slug}-${new Date().toISOString().slice(0, 10)}.csv`
  setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="${filename}"`)
  // Excel UX: BOM lets it auto-detect UTF-8 in the imported file.
  return '﻿' + lines.join('\r\n') + '\r\n'
})

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  // Always quote — CSV is forgiving and audit cells can contain commas,
  // newlines, quotes (especially in details_json).
  return '"' + s.replace(/"/g, '""') + '"'
}
