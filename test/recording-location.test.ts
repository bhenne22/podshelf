import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateEpisodeFields, normalizeRecordingLocation } from '../server/utils/validate'

// recording_location_type + recording_link are a pair with one invariant: a
// link is only ever stored for remote/mixed. The form enforces it by hiding
// the input, but the API is the surface that has to actually hold the line —
// these pin both the enum gate and the pairing rule.

const LINK = 'https://riverside.fm/studio/abc'

test('validateEpisodeFields accepts the three location types and empty', () => {
  for (const t of ['in_person', 'remote', 'mixed', '']) {
    assert.doesNotThrow(() => validateEpisodeFields({ recording_location_type: t }))
  }
  assert.doesNotThrow(() => validateEpisodeFields({}))
})

test('validateEpisodeFields rejects an unknown location type', () => {
  assert.throws(
    () => validateEpisodeFields({ recording_location_type: 'hybrid' }),
    /recording_location_type must be one of/,
  )
})

test('validateEpisodeFields holds recording_link to http(s)', () => {
  assert.doesNotThrow(() => validateEpisodeFields({ recording_link: LINK }))
  assert.doesNotThrow(() => validateEpisodeFields({ recording_link: 'http://meet.local/room' }))
  // The link renders as a clickable href in the episode form — a javascript:
  // scheme here would be stored XSS aimed at the hosts.
  assert.throws(
    () => validateEpisodeFields({ recording_link: 'javascript:alert(1)' }),
    /must be an http\(s\) URL/,
  )
  assert.throws(() => validateEpisodeFields({ recording_link: 'not a url' }), /must be a valid URL/)
  assert.throws(
    () => validateEpisodeFields({ recording_link: `https://x.test/${'a'.repeat(2100)}` }),
    /2048 characters or fewer/,
  )
})

test('normalizeRecordingLocation keeps the link for remote and mixed', () => {
  assert.deepEqual(normalizeRecordingLocation('remote', LINK), { locationType: 'remote', link: LINK })
  assert.deepEqual(normalizeRecordingLocation('mixed', LINK), { locationType: 'mixed', link: LINK })
})

test('normalizeRecordingLocation drops the link when nobody is dialling in', () => {
  // in_person and "not specified" both hide the input, so a stale link must
  // not survive in the DB where the form can no longer show or clear it.
  assert.deepEqual(normalizeRecordingLocation('in_person', LINK), { locationType: 'in_person', link: null })
  assert.deepEqual(normalizeRecordingLocation('', LINK), { locationType: null, link: null })
  assert.deepEqual(normalizeRecordingLocation(null, LINK), { locationType: null, link: null })
})

test('normalizeRecordingLocation treats empty strings as no value', () => {
  assert.deepEqual(normalizeRecordingLocation('remote', ''), { locationType: 'remote', link: null })
  assert.deepEqual(normalizeRecordingLocation('remote', '   '), { locationType: 'remote', link: null })
  assert.deepEqual(normalizeRecordingLocation('remote', `  ${LINK}  `), { locationType: 'remote', link: LINK })
})
