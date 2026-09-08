import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  normalizePullQuote,
  normalizeTimecode,
  MAX_QUOTE_LENGTH,
  MAX_SPEAKER_LENGTH,
} from '../server/utils/pull-quotes'

// Pull quotes are the one episode surface written by an automated pipeline
// (transcript → quotes → bulk import), so the write-path validator is the
// thing standing between a bad generation run and a table full of junk.
// These pin the normalization rules; the endpoints are thin over them.

test('normalizePullQuote requires non-empty quote text', () => {
  for (const bad of [{}, { quote: '' }, { quote: '   ' }, { quote: 42 }]) {
    assert.throws(() => normalizePullQuote(bad), /quote text is required/)
  }
})

test('normalizePullQuote rejects a non-object row', () => {
  for (const bad of [null, undefined, 'a quote', 7]) {
    assert.throws(() => normalizePullQuote(bad), /expected an object/)
  }
})

test('normalizePullQuote trims and passes through speaker + timecode', () => {
  const q = normalizePullQuote({
    quote: '  We did not, in fact, run 100 miles.  ',
    speaker: '  Bob  ',
    timecode: ' 00:14:32 ',
  })
  assert.equal(q.quote, 'We did not, in fact, run 100 miles.')
  assert.equal(q.speaker, 'Bob')
  assert.equal(q.timecode, '00:14:32')
})

test('empty speaker/timecode normalize to null rather than ""', () => {
  const q = normalizePullQuote({ quote: 'A line.', speaker: '   ', timecode: '' })
  assert.equal(q.speaker, null)
  assert.equal(q.timecode, null)

  const missing = normalizePullQuote({ quote: 'A line.' })
  assert.equal(missing.speaker, null)
  assert.equal(missing.timecode, null)
})

test('length caps are enforced on quote and speaker', () => {
  assert.throws(
    () => normalizePullQuote({ quote: 'x'.repeat(MAX_QUOTE_LENGTH + 1) }),
    /quote must be \d+ characters or fewer/,
  )
  assert.throws(
    () => normalizePullQuote({ quote: 'ok', speaker: 'y'.repeat(MAX_SPEAKER_LENGTH + 1) }),
    /speaker must be \d+ characters or fewer/,
  )
  // Exactly at the cap is fine.
  assert.equal(normalizePullQuote({ quote: 'x'.repeat(MAX_QUOTE_LENGTH) }).quote.length, MAX_QUOTE_LENGTH)
})

test('the bulk label prefixes the failing row index', () => {
  assert.throws(
    () => normalizePullQuote({ quote: '' }, 'quotes[3]'),
    /quotes\[3\]: quote text is required/,
  )
})

test('normalizeTimecode accepts MM:SS and HH:MM:SS shapes', () => {
  for (const good of ['14:32', '0:32', '00:14:32', '1:14:32', '123:14:32', '00:14:32.500']) {
    assert.equal(normalizeTimecode(good), good, `expected ${good} to be accepted`)
  }
})

test('normalizeTimecode rejects anything a renderer would have to guess at', () => {
  for (const bad of ['14', 'fourteen', '14:3', '14:322', '00:14:32:11', '-1:00']) {
    assert.throws(() => normalizeTimecode(bad), /must look like MM:SS or HH:MM:SS/, `expected ${bad} to be rejected`)
  }
})

// ---- Feed isolation ----
// The whole point of both features is that they never reach a listener.
// Pin it at the source rather than trusting a comment.

const feedSrc = readFileSync(
  resolve(__dirname, '..', 'server', 'routes', 'feeds', '[slug].xml.ts'),
  'utf-8',
)

test('the RSS feed never reads private_notes or pull quotes', () => {
  assert.ok(
    !feedSrc.includes('private_notes'),
    'private_notes must not appear in the feed renderer',
  )
  assert.ok(
    !feedSrc.includes('pull_quote') && !feedSrc.includes('episode_pull_quotes'),
    'pull quotes must not appear in the feed renderer',
  )
})
