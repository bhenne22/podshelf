/**
 * The single source of truth for webhook event names and delivery formats.
 *
 * This lives in the root `utils/` (importable by both the Nitro server and the
 * Vue app) rather than in `server/utils/webhook.ts` because that module pulls
 * in `getDb`, node crypto, and h3 — importing it from a client component would
 * drag all of that into the browser bundle. Keep this file dependency-free.
 *
 * The reason it exists: `components/WebhookManager.vue` used to keep its own
 * hardcoded copy of the event list, so an event added to the server enum was
 * accepted by the API but could never be ticked in the UI. `server/utils/
 * webhook.ts` re-exports everything here, so its existing importers are
 * unchanged; the component imports from here directly.
 */

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

export const WEBHOOK_FORMATS = ['discord', 'slack', 'generic'] as const
export type WebhookFormat = typeof WEBHOOK_FORMATS[number]

export function isWebhookFormat(x: unknown): x is WebhookFormat {
  return typeof x === 'string' && (WEBHOOK_FORMATS as readonly string[]).includes(x)
}
