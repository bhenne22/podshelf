import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRecordingBody, type WebhookRecordingPayload } from '../server/utils/webhook'

// include_recording_link is a disclosure control, so the tests that matter are
// the negative ones: with the toggle off, the room URL must not appear in ANY
// format — including `generic`, which serializes the whole payload object and
// would otherwise leak straight past the chat-format checks.

const podcast = {
  slug: 'ys100m',
  title: 'You Said 100 Miles?',
  feed_url: 'https://podshelf.example.com/feeds/ys100m.xml',
  website: 'https://yousaid100miles.com',
}

const ROOM = 'https://riverside.fm/studio/secret-room'
const CAL = 'https://podshelf.example.com/schedule/event/42-1-abc.ics'

const rec: WebhookRecordingPayload = {
  kind: 'scheduled',
  episode_title: 'The One About Hyner',
  episode_url: 'https://yousaid100miles.com/episodes/hyner',
  episode_number: 12,
  season_number: 2,
  new_starts_at: '2026-09-01T14:00:00.000Z',
  new_duration_minutes: 60,
  previous_starts_at: null,
  previous_duration_minutes: null,
  podcast_timezone: 'America/New_York',
  recording_location_type: 'remote',
  recording_link: ROOM,
  calendar_url: CAL,
}

function build(format: 'discord' | 'slack' | 'generic', includeLink: boolean, over: Partial<WebhookRecordingPayload> = {}) {
  return buildRecordingBody(
    { url: 'https://example.com/hook', format, enabled: true, include_recording_link: includeLink },
    podcast,
    { ...rec, ...over },
  ).body
}

for (const format of ['discord', 'slack', 'generic'] as const) {
  test(`${format}: room URL is withheld when the toggle is off`, () => {
    const body = build(format, false)
    assert.ok(!body.includes(ROOM), `${format} body leaked the room URL: ${body}`)
  })

  test(`${format}: room URL is present when the toggle is on`, () => {
    assert.ok(build(format, true).includes(ROOM))
  })

  test(`${format}: room URL is withheld on a cancelled recording even when the toggle is on`, () => {
    const body = build(format, true, { kind: 'cancelled', new_starts_at: null, new_duration_minutes: null })
    assert.ok(!body.includes(ROOM), `${format} offered a room to join for a cancelled recording`)
  })
}

test('the location label is NOT secret — it shows even with the toggle off', () => {
  // Only the room URL is withheld. Knowing a recording is "Remote" tells a
  // public channel nothing it shouldn't have.
  assert.match(build('discord', false), /Remote/)
})

test('discord: calendar link renders as a markdown link in a field', () => {
  const parsed = JSON.parse(build('discord', true))
  const fields = parsed.embeds[0].fields as { name: string; value: string }[]
  const cal = fields.find((f) => f.name === 'Calendar')
  assert.ok(cal, 'expected a Calendar field')
  assert.equal(cal!.value, `[Add to calendar](${CAL})`)
})

test('discord: no fields block at all when there is nothing to add', () => {
  const parsed = JSON.parse(build('discord', false, {
    recording_location_type: null,
    recording_link: null,
    calendar_url: null,
  }))
  assert.equal(parsed.embeds[0].fields, undefined)
})

test('slack: join and calendar links join the episode link on one line', () => {
  const parsed = JSON.parse(build('slack', true))
  const text = parsed.blocks[0].text.text as string
  assert.match(text, /<https:\/\/riverside\.fm\/studio\/secret-room\|Join recording>/)
  assert.match(text, /\|Add to calendar>/)
})

test('generic: recording_link is redacted to null rather than dropped', () => {
  // Consumers key off the field's presence; flipping it to null keeps the
  // shape stable while still withholding the value.
  const parsed = JSON.parse(build('generic', false))
  assert.equal(parsed.recording.recording_link, null)
  assert.equal(parsed.recording.recording_location_type, 'remote')
})

test('generic: calendar_url survives the round trip when present', () => {
  const parsed = JSON.parse(build('generic', true))
  assert.equal(parsed.recording.calendar_url, CAL)
  assert.equal(parsed.recording.recording_link, ROOM)
})

test('a config that simply omits include_recording_link withholds the room', () => {
  // Fail-safe default: the field is optional on WebhookConfig, and absent
  // must never mean "disclose".
  const body = buildRecordingBody(
    { url: 'https://example.com/hook', format: 'generic', enabled: true },
    podcast,
    rec,
  ).body
  assert.ok(!body.includes(ROOM))
})
