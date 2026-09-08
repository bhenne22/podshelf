import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  normalizePullQuote,
  normalizeTimecode,
  normalizeApproved,
  parseApprovedFilter,
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

// ---- Review gate ----
// Only approved quotes leave Podshelf. The failure mode being guarded here is
// a silent one: a read path that forgets the filter publishes unreviewed
// machine-generated text to a public website, and nothing errors.

test('parseApprovedFilter defaults to approved-only', () => {
  for (const absent of [undefined, null, '']) {
    assert.equal(parseApprovedFilter(absent).includeUnapproved, false,
      'a caller that passes nothing must get the gated view')
  }
  assert.equal(parseApprovedFilter('true').includeUnapproved, false)
  assert.equal(parseApprovedFilter('any').includeUnapproved, true)
})

test('parseApprovedFilter rejects anything it does not understand', () => {
  // Notably "false" and "0": a typo must not be read as "show me everything".
  for (const bad of ['false', '0', 'all', 'yes', '1']) {
    assert.throws(() => parseApprovedFilter(bad), /approved must be/, `expected ${bad} to be rejected`)
  }
})

test('normalizeApproved accepts booleans and 0/1, rejects the rest', () => {
  for (const truthy of [true, 1, '1', 'true']) assert.equal(normalizeApproved(truthy), 1)
  for (const falsy of [false, 0, '0', 'false']) assert.equal(normalizeApproved(falsy), 0)
  for (const bad of ['yes', 'approved', 2, null, undefined, {}]) {
    assert.throws(() => normalizeApproved(bad), /approved must be a boolean/)
  }
})

// ---- Gate wiring, pinned at the source ----

const utilSrc = readFileSync(
  resolve(__dirname, '..', 'server', 'utils', 'pull-quotes.ts'),
  'utf-8',
)
const includeSrc = readFileSync(
  resolve(__dirname, '..', 'server', 'api', 'podcasts', '[slug]', 'episodes', '[id].get.ts'),
  'utf-8',
)

test('listPullQuotes filters to approved unless told otherwise', () => {
  assert.match(
    utilSrc,
    /const where = opts\.includeUnapproved \? '' : ' AND approved = 1'/,
    'the default branch of listPullQuotes must apply the approved filter',
  )
})

test('the downstream sync include cannot ask for unapproved quotes', () => {
  // ?include=pull_quotes is the one path that feeds a public site build, so
  // it calls listPullQuotes with no opt-out available.
  const block = includeSrc.match(/if \(include\.has\('pull_quotes'\)\) \{[\s\S]+?\n  \}/)
  assert.ok(block, 'pull_quotes include block should be extractable')
  assert.match(block![0], /listPullQuotes\(episode\.id\)/)
  assert.ok(
    !/includeUnapproved/.test(block![0]),
    'the sync path must never pass includeUnapproved',
  )
})

test('the bulk importer cannot grant approval', () => {
  const bulkSrc = readFileSync(
    resolve(__dirname, '..', 'server', 'api', 'podcasts', '[slug]', 'episodes', '[id]',
      'pull-quotes', 'bulk.post.ts'),
    'utf-8',
  )
  // Approval is a human act. The INSERT must not carry an approved column —
  // it takes the schema default of 0.
  const insert = bulkSrc.match(/INSERT INTO episode_pull_quotes[^`]+/)
  assert.ok(insert, 'bulk INSERT should be extractable')
  assert.ok(
    !/approved/.test(insert![0]),
    'bulk import must not set approved — imported quotes start unreviewed',
  )
})
