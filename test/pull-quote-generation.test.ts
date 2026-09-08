import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCues,
  formatTimecode,
  quoteTarget,
  buildIndex,
  verify,
} from '../scripts/generate-pull-quotes'

// The generator hands unreviewed model output straight into a write endpoint,
// so the two things worth pinning are the quota (how many we ask for) and the
// verifier (what we refuse to write). Everything else in that script is I/O.

// ---- Transcript parsing ----
// Real shape of a YWIW transcript: SRT, "[Name] " speaker prefix, ASR text
// with sentences running across cue boundaries.

const SRT = `1
00:00:01,011 --> 00:00:17,338
[Sass] i'm a little sad it took us that long to come up with ophthalmologist

2
00:00:17,458 --> 00:00:23,181
[Erica] so often and it's really upsetting i don't like it it's bad

3
00:01:38,100 --> 00:01:46,271
[Erica] would you like to talk about the new pr cards that has been hotel is putting out
`

test('parseCues reads SRT timestamps, speakers and text', () => {
  const cues = parseCues(SRT, 'application/srt', 'ep.srt')
  assert.equal(cues.length, 3)
  assert.equal(cues[0].speaker, 'Sass')
  assert.equal(cues[1].speaker, 'Erica')
  assert.ok(Math.abs(cues[0].t - 1.011) < 0.001)
  assert.ok(Math.abs(cues[2].t - 98.1) < 0.001)
  assert.match(cues[0].text, /^i'm a little sad/)
})

test('parseCues handles WebVTT and its <v Name> speaker form', () => {
  const vtt = `WEBVTT

00:00:05.000 --> 00:00:09.000
<v Sass>this is the vtt shape

00:01:00.000 --> 00:01:04.000
<v Erica>and a second cue</v>
`
  const cues = parseCues(vtt, 'text/vtt', 'ep.vtt')
  assert.equal(cues.length, 2)
  assert.equal(cues[0].speaker, 'Sass')
  assert.equal(cues[1].speaker, 'Erica')
  assert.equal(cues[1].text, 'and a second cue')
  assert.equal(cues[1].t, 60)
})

test('formatTimecode drops the hour only below an hour', () => {
  assert.equal(formatTimecode(0), '0:00')
  assert.equal(formatTimecode(65), '1:05')
  assert.equal(formatTimecode(3600), '1:00:00')
  assert.equal(formatTimecode(8268), '2:17:48')
})

// ---- Quota ----
// "At least 2 per episode, cutoff ~3/hr of audio."

test('quoteTarget floors at 2 and otherwise runs ~3 per hour', () => {
  assert.equal(quoteTarget(25 * 60), 2, '25 min → floor')
  assert.equal(quoteTarget(40 * 60), 2, '40 min → floor (3×0.67 rounds to 2)')
  assert.equal(quoteTarget(60 * 60), 3, '1 h → 3')
  assert.equal(quoteTarget(90 * 60), 5, '1h30 → 5')
  assert.equal(quoteTarget(137 * 60), 7, '2h17 → 7')
  assert.equal(quoteTarget(180 * 60), 9, '3 h → 9')
})

test('quoteTarget never returns less than the floor, even for junk durations', () => {
  assert.equal(quoteTarget(0), 2)
  assert.equal(quoteTarget(30), 2)
})

// ---- Verification ----
// The transcripts are ASR output, so a quote is matched against a normalized
// copy of the transcript: punctuation and capitalization the model added are
// forgiven, invented words are not.

const index = buildIndex(parseCues(SRT, 'application/srt'))

test('a verbatim span verifies and derives speaker + timecode from the cue', () => {
  const r = verify(index, 'it took us that long to come up with ophthalmologist')
  assert.ok(r.ok)
  assert.equal(r.speaker, 'Sass')
  assert.equal(r.timecode, '0:01')
})

test('added punctuation and capitalization are forgiven', () => {
  const r = verify(index, "So often, and it's really upsetting. I don't like it — it's bad!")
  assert.ok(r.ok, 'a repunctuated span should still verify')
  assert.equal(r.speaker, 'Erica')
})

test('an invented or reworded quote is rejected', () => {
  const r = verify(index, 'I am somewhat saddened by our sluggish recall of ophthalmologist')
  assert.ok(!r.ok)
  assert.match(r.reason, /not found in transcript/)
})

test('a quote stitched across a speaker change is rejected', () => {
  // Cue 1 ends "...ophthalmologist", cue 2 starts "so often..." — contiguous in
  // the transcript text, but two different people. Attributing that to one
  // speaker would be worse than dropping the candidate.
  const r = verify(index, "come up with ophthalmologist so often and it's really upsetting")
  assert.ok(!r.ok)
  assert.match(r.reason, /spans a speaker change/)
})

test('a too-short fragment is rejected rather than matched by luck', () => {
  const r = verify(index, "it's bad")
  assert.ok(!r.ok)
  assert.match(r.reason, /too short/)
})

test('a line repeated in the transcript verifies but claims no timecode', () => {
  const repeated = buildIndex(parseCues(`1
00:00:01,000 --> 00:00:05,000
[Sass] these are puppets calm down

2
00:10:00,000 --> 00:10:04,000
[Sass] these are puppets calm down
`, 'application/srt'))
  const r = verify(repeated, 'these are puppets calm down')
  assert.ok(r.ok, 'the quote is real, so keep it')
  assert.equal(r.timecode, null, 'but we cannot say which occurrence it was')
  assert.equal(r.speaker, 'Sass')
})
