import type { H3Event } from 'h3'
import getDb from '../db/index'

export interface AuditEntry {
  podcastId?: number | null
  userId?: number | null
  apiKeyId?: number | null
  action: string
  entityType?: string | null
  entityId?: number | null
  summary?: string | null
  details?: unknown
}

/**
 * Append a row to the audit log. Cheap, synchronous, never throws.
 * Failures are swallowed (logged to console) — auditing should not break
 * the user request that triggered it.
 *
 * When called with an h3 event, the api_key_id is auto-stamped from
 * `event.context.apiKeyId` (set by requireAuthContext at auth time) so
 * actions taken by an API key are credited to the key, not the underlying
 * user. System events (scheduler, migration worker) call without an event.
 */
export function logAudit(entry: AuditEntry): void
export function logAudit(event: H3Event, entry: AuditEntry): void
export function logAudit(eventOrEntry: H3Event | AuditEntry, maybeEntry?: AuditEntry): void {
  let entry: AuditEntry
  if (maybeEntry) {
    const event = eventOrEntry as H3Event
    const ctxKeyId = (event.context?.apiKeyId as number | null | undefined) ?? null
    entry = { ...maybeEntry, apiKeyId: maybeEntry.apiKeyId ?? ctxKeyId }
  } else {
    entry = eventOrEntry as AuditEntry
  }
  try {
    const db = getDb()
    const detailsJson = entry.details === undefined || entry.details === null
      ? null
      : JSON.stringify(entry.details)
    db.prepare(`
      INSERT INTO audit_log (podcast_id, user_id, api_key_id, action, entity_type, entity_id, summary, details)
      VALUES (@podcast_id, @user_id, @api_key_id, @action, @entity_type, @entity_id, @summary, @details)
    `).run({
      podcast_id: entry.podcastId ?? null,
      user_id: entry.userId ?? null,
      api_key_id: entry.apiKeyId ?? null,
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      summary: entry.summary ?? null,
      details: detailsJson,
    })
  } catch (err) {
    console.error('[audit] failed to log entry', { entry, err })
  }
}

/**
 * Diff two records for fields that changed. Returns the list of changed
 * field names plus a structured before/after object for the audit details.
 *
 * Intentionally treats "" / null / undefined as equivalent — typing in a
 * field then deleting it again shouldn't show up as a change. Skips
 * `updated_at` and any fields named in `skip`.
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  skip: string[] = ['updated_at', 'created_at'],
): { changed: string[]; before: Record<string, unknown>; after: Record<string, unknown> } {
  const skipSet = new Set(skip)
  const changed: string[] = []
  const beforeOut: Record<string, unknown> = {}
  const afterOut: Record<string, unknown> = {}
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const k of keys) {
    if (skipSet.has(k)) continue
    const a = before[k]
    const b = after[k]
    const aNorm = a === '' ? null : a
    const bNorm = b === '' ? null : b
    if (aNorm !== bNorm) {
      changed.push(k)
      beforeOut[k] = a ?? null
      afterOut[k] = b ?? null
    }
  }
  return { changed, before: beforeOut, after: afterOut }
}

/**
 * Convenience: format a "Updated X: a, b, c" style summary from a list of
 * changed fields. Returns a fallback when nothing changed (callers should
 * usually short-circuit before calling logAudit in that case).
 */
export function summarizeChanges(prefix: string, changed: string[]): string {
  if (changed.length === 0) return `${prefix} (no changes)`
  return `${prefix}: ${changed.join(', ')}`
}
