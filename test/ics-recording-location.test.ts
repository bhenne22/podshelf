import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderIcsFeed, type IcsEpisode } from '../server/utils/ics'

// The REC event is the one you look at 30 seconds before a remote recording,
// so the join link has to survive into LOCATION (where clients render the
// tappable "where") as well as DESCRIPTION (for clients that don't linkify
// LOCATION). DROP events describe a publish date and must stay clean.

const base: IcsEpisode = {
  id: 7,
  title: 'The One About Hyner',
  slug: 'the-one-about-hyner',
  description: '<p>Show notes &amp; things</p>',
  status: 'draft',
  published_at: null,
  recording_starts_at: '2026-09-01T14:00:00.000Z',
  recording_duration_minutes: 60,
  recording_location_type: null,
  recording_link: null,
  updated_at: '2026-08-13T00:00:00.000Z',
  podcast_title: 'You Said 100 Miles?',
  podcast_website: 'https://yousaid100miles.com',
}

function render(ep: Partial<IcsEpisode>, includeRecordingLink?: boolean): string {
  return renderIcsFeed([{ ...base, ...ep }], {
    scopeKind: 'podcast',
    calendarName: 'Test',
    ...(includeRecordingLink === undefined ? {} : { includeRecordingLink }),
  })
}

/** Unfold RFC 5545 continuation lines so assertions can match whole values. */
function unfold(ics: string): string {
  return ics.replace(/\r\n[ \t]/g, '')
}

test('remote recording puts the join link in LOCATION', () => {
  const out = unfold(render({ recording_location_type: 'remote', recording_link: 'https://riverside.fm/studio/abc' }))
  assert.match(out, /LOCATION:https:\/\/riverside\.fm\/studio\/abc/)
})

test('remote recording also states location + link in DESCRIPTION', () => {
  const out = unfold(render({ recording_location_type: 'remote', recording_link: 'https://riverside.fm/studio/abc' }))
  assert.match(out, /Recording: Remote — https:\/\/riverside\.fm\/studio\/abc/)
})

test('mixed recording is labelled distinctly from remote', () => {
  const out = unfold(render({ recording_location_type: 'mixed', recording_link: 'https://zoom.us/j/1' }))
  assert.match(out, /Recording: Mixed \(in person \+ remote\) — https:\/\/zoom\.us\/j\/1/)
  assert.match(out, /LOCATION:https:\/\/zoom\.us\/j\/1/)
})

test('in-person recording gets the label as LOCATION and no link', () => {
  const out = unfold(render({ recording_location_type: 'in_person' }))
  assert.match(out, /LOCATION:In person/)
  assert.match(out, /Recording: In person/)
  assert.doesNotMatch(out, /http.*:\/\/.*zoom/)
})

test('unspecified location emits no LOCATION line', () => {
  const out = unfold(render({}))
  assert.doesNotMatch(out, /LOCATION:/)
  assert.doesNotMatch(out, /Recording: /)
})

test('DROP events carry no recording location', () => {
  // Published episode with a recording slot produces both a REC and a DROP
  // event; only the REC one should mention where the recording happens.
  const out = unfold(render({
    status: 'published',
    published_at: '2026-09-08T00:00:00.000Z',
    recording_location_type: 'remote',
    recording_link: 'https://riverside.fm/studio/abc',
  }))
  const events = out.split('BEGIN:VEVENT').slice(1)
  assert.equal(events.length, 2, 'expected one REC and one DROP event')
  const rec = events.find((e) => e.includes('SUMMARY:REC:'))!
  const drop = events.find((e) => e.includes('SUMMARY:DROP:'))!
  assert.match(rec, /LOCATION:https:\/\/riverside\.fm\/studio\/abc/)
  assert.doesNotMatch(drop, /LOCATION:/)
  assert.doesNotMatch(drop, /Recording: /)
})

test('the episode URL still lands in DESCRIPTION alongside the recording line', () => {
  const out = unfold(render({ recording_location_type: 'remote', recording_link: 'https://zoom.us/j/1' }))
  assert.match(out, /https:\/\/yousaid100miles\.com\/episodes\/the-one-about-hyner/)
})

test('includeRecordingLink:false withholds the room URL but keeps the label', () => {
  // This is what a public-channel "add to calendar" link resolves to. The
  // .ics still says the recording is remote — it just doesn't hand over the
  // room. Otherwise the calendar file would route around the webhook toggle.
  const out = unfold(render(
    { recording_location_type: 'remote', recording_link: 'https://riverside.fm/studio/secret' },
    false,
  ))
  assert.doesNotMatch(out, /riverside\.fm/)
  assert.match(out, /LOCATION:Remote/)
  assert.match(out, /Recording: Remote/)
})

test('includeRecordingLink defaults to true for the subscription feed', () => {
  // The per-user .ics subscription is authenticated by its own token, so it
  // gets the full detail unless a caller explicitly opts out.
  const out = unfold(render({ recording_location_type: 'remote', recording_link: 'https://zoom.us/j/9' }))
  assert.match(out, /LOCATION:https:\/\/zoom\.us\/j\/9/)
})

test('a link containing a comma or semicolon is escaped for TEXT properties', () => {
  // LOCATION is a TEXT property, so RFC 5545 requires , and ; be escaped —
  // an unescaped comma would make clients read it as a value list.
  const out = unfold(render({
    recording_location_type: 'remote',
    recording_link: 'https://meet.example.com/room?a=1,2;3',
  }))
  assert.match(out, /LOCATION:https:\/\/meet\.example\.com\/room\?a=1\\,2\\;3/)
})
