import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  WEBHOOK_EVENTS,
  WEBHOOK_FORMATS,
  isWebhookEvent,
  isWebhookFormat,
} from '../utils/webhook-events'
// Re-imported through the server module to prove the re-export contract that
// the 12 `import … from '…/utils/webhook'` call sites depend on still holds.
import {
  WEBHOOK_EVENTS as SERVER_WEBHOOK_EVENTS,
  isWebhookEvent as serverIsWebhookEvent,
} from '../server/utils/webhook'

// The shared list is the single source of truth for webhook event names; the
// UI, the API validators, and the DB event JSON all derive from it. These pin
// the set so a removal or typo is caught, and confirm the guards accept exactly
// that set.

test('WEBHOOK_EVENTS is exactly the known set', () => {
  assert.deepEqual([...WEBHOOK_EVENTS], [
    'episode.publish',
    'episode.recording.scheduled',
    'episode.recording.moved',
    'episode.recording.cancelled',
    'correction.submitted',
  ])
})

test('isWebhookEvent accepts every listed event and rejects others', () => {
  for (const e of WEBHOOK_EVENTS) assert.equal(isWebhookEvent(e), true)
  assert.equal(isWebhookEvent('episode.unpublish'), false)
  assert.equal(isWebhookEvent(''), false)
  assert.equal(isWebhookEvent(undefined), false)
  assert.equal(isWebhookEvent(null), false)
})

test('isWebhookFormat guards the delivery formats', () => {
  for (const f of WEBHOOK_FORMATS) assert.equal(isWebhookFormat(f), true)
  assert.deepEqual([...WEBHOOK_FORMATS], ['discord', 'slack', 'generic'])
  assert.equal(isWebhookFormat('email'), false)
  assert.equal(isWebhookFormat(42), false)
})

test('server/utils/webhook re-exports the shared symbols unchanged', () => {
  assert.deepEqual([...SERVER_WEBHOOK_EVENTS], [...WEBHOOK_EVENTS])
  assert.equal(serverIsWebhookEvent, isWebhookEvent)
})
