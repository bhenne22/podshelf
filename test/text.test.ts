import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeEntities, inferEpisodeNumberFromTitle } from '../server/utils/text'

test('decodeEntities: decimal numeric references', () => {
  assert.equal(decodeEntities('SI #146 &#8211; We Recorded Again!'), 'SI #146 – We Recorded Again!')
  assert.equal(decodeEntities('We&#8217;re Back, Baby!'), 'We’re Back, Baby!')
  assert.equal(decodeEntities('Sometimes We Get Busy&#8230;'), 'Sometimes We Get Busy…')
})

test('decodeEntities: hex numeric references', () => {
  assert.equal(decodeEntities('em &#x2014; dash'), 'em — dash')
})

test('decodeEntities: named XML entities', () => {
  assert.equal(decodeEntities('A &amp; B'), 'A & B')
  assert.equal(decodeEntities('&lt;tag&gt;'), '<tag>')
  assert.equal(decodeEntities('&quot;quoted&quot;'), '"quoted"')
})

test('decodeEntities: leaves non-entity text intact', () => {
  assert.equal(decodeEntities('plain text with #1 and -dashes-'), 'plain text with #1 and -dashes-')
  assert.equal(decodeEntities(''), '')
  assert.equal(decodeEntities(null), '')
  assert.equal(decodeEntities(undefined), '')
})

test('decodeEntities: bug 1 acceptance fixture', () => {
  // The exact case from the user's report.
  const input = 'Episode &#8211; with &#8217;quotes&#8217; and &amp;ampersand'
  const expected = 'Episode – with ’quotes’ and &ampersand'
  assert.equal(decodeEntities(input), expected)
})

test('inferEpisodeNumberFromTitle: parses #N pattern', () => {
  assert.equal(inferEpisodeNumberFromTitle('SI #146 – We Recorded Again!'), 146)
  assert.equal(inferEpisodeNumberFromTitle('SI #143 – We’re Back, Baby!'), 143)
  assert.equal(inferEpisodeNumberFromTitle('Subtle Interference #58 February show'), 58)
  assert.equal(inferEpisodeNumberFromTitle('Subtle Interference #1 October ep'), 1)
})

test('inferEpisodeNumberFromTitle: returns null without a clear pattern', () => {
  assert.equal(inferEpisodeNumberFromTitle('Subtle Interference – The Challenge Bloodlines'), null)
  assert.equal(inferEpisodeNumberFromTitle('Subtle Interference – WrestleMania 34 Preview'), null)
  assert.equal(inferEpisodeNumberFromTitle(''), null)
  assert.equal(inferEpisodeNumberFromTitle(null), null)
})

test('inferEpisodeNumberFromTitle: tolerates whitespace', () => {
  assert.equal(inferEpisodeNumberFromTitle('Episode # 42'), 42)
  assert.equal(inferEpisodeNumberFromTitle('Episode #42'), 42)
})

test('inferEpisodeNumberFromTitle: parses anchored "Episode N" / "Ep N" prefixes', () => {
  // OIWT shape — "Episode 24: Darcy Is A Sociopath", "Episode 1: Pilot"
  assert.equal(inferEpisodeNumberFromTitle('Episode 24: Darcy Is A Sociopath'), 24)
  assert.equal(inferEpisodeNumberFromTitle('Episode 1: Pilot'), 1)
  // Hyphenated separator instead of colon
  assert.equal(inferEpisodeNumberFromTitle('Episode 100 - The Recap'), 100)
  // Short "Ep" / "Ep." abbreviations
  assert.equal(inferEpisodeNumberFromTitle('Ep 5: Some title'), 5)
  assert.equal(inferEpisodeNumberFromTitle('Ep. 12: Title'), 12)
  // Case-insensitive
  assert.equal(inferEpisodeNumberFromTitle('episode 7: lowercase'), 7)
  assert.equal(inferEpisodeNumberFromTitle('EPISODE 8: SHOUTING'), 8)
})

test('inferEpisodeNumberFromTitle: only anchors at the start (avoids false positives)', () => {
  // Phrase like "Episode 4 of Stranger Things" must NOT match — the prefix
  // form requires it at the start of the title.
  assert.equal(
    inferEpisodeNumberFromTitle('We talk about Episode 4 of Stranger Things'),
    null,
  )
})
