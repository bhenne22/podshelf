import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeCorrectionInput,
  isHoneypotTripped,
  isCorrectionStatus,
} from '../server/utils/correction'

// POST /api/public/corrections is unauthenticated, so this validator is the
// only thing between the open internet and the corrections table. These pin
// the gates: required fields, length caps, and URL scheme.

const valid = {
  podcast_slug: 'ys100m',
  claim: 'We said Hyner is 50 miles.',
  correction: 'The Hyner View Trail Challenge is 25k and 50k, not 50 miles.',
}

test('normalizeCorrectionInput accepts a minimal valid submission', () => {
  const out = normalizeCorrectionInput({ ...valid })
  assert.equal(out.podcastSlug, 'ys100m')
  assert.equal(out.claim, valid.claim)
  assert.equal(out.correction, valid.correction)
  assert.equal(out.episodeSlug, null)
  assert.equal(out.timecode, null)
  assert.equal(out.sourceUrl, null)
  assert.equal(out.submitterName, null)
  assert.equal(out.submitterContact, null)
})

test('normalizeCorrectionInput trims and nulls blank optionals', () => {
  const out = normalizeCorrectionInput({
    ...valid,
    episode_slug: '  ys100m-wheres-the-finish  ',
    timecode: '   ',
    name: '  Shae  ',
  })
  assert.equal(out.episodeSlug, 'ys100m-wheres-the-finish')
  assert.equal(out.timecode, null)
  assert.equal(out.submitterName, 'Shae')
})

test('normalizeCorrectionInput requires claim and correction', () => {
  assert.throws(() => normalizeCorrectionInput({ ...valid, claim: '' }), /claim is required/)
  assert.throws(() => normalizeCorrectionInput({ ...valid, correction: '   ' }), /correction is required/)
  assert.throws(() => normalizeCorrectionInput({ claim: 'a', correction: 'b' }), /podcast_slug is required/)
})

test('normalizeCorrectionInput enforces length caps', () => {
  assert.throws(
    () => normalizeCorrectionInput({ ...valid, claim: 'x'.repeat(4001) }),
    /claim must be 4000 characters or fewer/,
  )
  assert.throws(
    () => normalizeCorrectionInput({ ...valid, name: 'x'.repeat(121) }),
    /name must be 120 characters or fewer/,
  )
  // Exactly at the cap is fine.
  assert.equal(normalizeCorrectionInput({ ...valid, claim: 'x'.repeat(4000) }).claim.length, 4000)
})

test('normalizeCorrectionInput rejects non-http(s) source URLs', () => {
  assert.throws(
    () => normalizeCorrectionInput({ ...valid, source_url: 'javascript:alert(1)' }),
    /source_url must be an http\(s\) URL/,
  )
  assert.throws(
    () => normalizeCorrectionInput({ ...valid, source_url: 'not a url' }),
    /source_url must be a valid URL/,
  )
  assert.equal(
    normalizeCorrectionInput({ ...valid, source_url: 'https://utmb.world/hyner' }).sourceUrl,
    'https://utmb.world/hyner',
  )
})

test('isHoneypotTripped only fires on non-empty content', () => {
  assert.equal(isHoneypotTripped({}), false)
  assert.equal(isHoneypotTripped({ hp: '' }), false)
  assert.equal(isHoneypotTripped({ hp: '   ' }), false)
  assert.equal(isHoneypotTripped({ hp: 'https://buy-pills.example' }), true)
})

test('isCorrectionStatus guards the triage enum', () => {
  for (const s of ['new', 'confirmed', 'rejected', 'aired']) {
    assert.equal(isCorrectionStatus(s), true)
  }
  assert.equal(isCorrectionStatus('deleted'), false)
  assert.equal(isCorrectionStatus(undefined), false)
})
