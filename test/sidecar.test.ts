import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseTimestamp,
  parseSrt,
  parseVtt,
  validateTranscript,
  validateChaptersJson,
  formatHms,
} from '../server/utils/sidecar'

test('parseTimestamp: HH:MM:SS,mmm', () => {
  assert.equal(parseTimestamp('00:01:23,500'), 83.5)
  assert.equal(parseTimestamp('01:00:00,000'), 3600)
})

test('parseTimestamp: HH:MM:SS.mmm', () => {
  assert.equal(parseTimestamp('00:00:05.250'), 5.25)
})

test('parseTimestamp: MM:SS.mmm (no hours)', () => {
  assert.equal(parseTimestamp('02:30.000'), 150)
})

test('parseTimestamp: invalid returns NaN', () => {
  assert.ok(Number.isNaN(parseTimestamp('not a timestamp')))
  assert.ok(Number.isNaN(parseTimestamp('')))
})

test('parseSrt: parses standard cue blocks', () => {
  const raw = `1
00:00:00,000 --> 00:00:05,000
Hello world

2
00:00:06,000 --> 00:00:10,000
BOB: This is a line

3
00:00:11,000 --> 00:00:15,000
[KEVIN] Hi there`
  const cues = parseSrt(raw)
  assert.equal(cues.length, 3)
  assert.equal(cues[0].text, 'Hello world')
  assert.equal(cues[0].speaker, '')
  assert.equal(cues[1].speaker, 'BOB')
  assert.equal(cues[1].text, 'This is a line')
  assert.equal(cues[2].speaker, 'KEVIN')
  assert.equal(cues[2].text, 'Hi there')
})

test('parseSrt: tolerates CRLF line endings', () => {
  const raw = '1\r\n00:00:00,000 --> 00:00:05,000\r\nHello\r\n\r\n2\r\n00:00:06,000 --> 00:00:10,000\r\nWorld'
  const cues = parseSrt(raw)
  assert.equal(cues.length, 2)
  assert.equal(cues[1].text, 'World')
})

test('parseSrt: skips malformed cue blocks', () => {
  const raw = `1
not a timestamp
Hello

2
00:00:06,000 --> 00:00:10,000
Good cue`
  const cues = parseSrt(raw)
  assert.equal(cues.length, 1)
  assert.equal(cues[0].text, 'Good cue')
})

test('parseVtt: parses with WEBVTT header + voice tag', () => {
  const raw = `WEBVTT

00:00:00.000 --> 00:00:05.000
<v Bob>Hello world

00:00:06.000 --> 00:00:10.000
Plain line`
  const cues = parseVtt(raw)
  assert.equal(cues.length, 2)
  assert.equal(cues[0].speaker, 'Bob')
  assert.equal(cues[0].text, 'Hello world')
  assert.equal(cues[1].speaker, '')
})

test('validateTranscript: SRT happy path with summary', () => {
  const srt = `1
00:00:00,000 --> 00:00:05,000
BOB: Welcome

2
00:01:00,000 --> 00:01:05,000
KEVIN: Thanks for having me`
  const result = validateTranscript(srt, 'application/srt', 'episode.srt')
  assert.equal(result.ok, true)
  assert.equal(result.summary?.kind, 'srt')
  assert.equal(result.summary?.cueCount, 2)
  assert.deepEqual(result.summary?.speakers, ['BOB', 'KEVIN'])
  assert.equal(result.summary?.durationSeconds, 60)
})

test('validateTranscript: unrecognized format passes through with null summary', () => {
  const html = '<p>Plain HTML transcript</p>'
  const result = validateTranscript(html, 'text/html', 'episode.html')
  assert.equal(result.ok, true)
  assert.equal(result.summary, null)
  assert.equal(result.errors.length, 0)
})

test('validateTranscript: zero-cue SRT fails', () => {
  const raw = 'this is not valid SRT at all'
  const result = validateTranscript(raw, 'application/srt', 'episode.srt')
  assert.equal(result.ok, false)
  assert.match(result.errors[0], /zero cues/)
})

test('validateTranscript: JSON cue array', () => {
  const json = JSON.stringify([
    { t: 0, speaker: 'BOB', text: 'Hi' },
    { t: 30, speaker: 'KEVIN', text: 'Hello' },
  ])
  const result = validateTranscript(json, 'application/json', 'episode.json')
  assert.equal(result.ok, true)
  assert.equal(result.summary?.cueCount, 2)
})

test('validateChaptersJson: happy path', () => {
  const text = JSON.stringify({
    version: '1.2.0',
    chapters: [
      { startTime: 0, title: 'Intro' },
      { startTime: 300, title: 'Topic one' },
      { startTime: 720, title: 'Wrap-up' },
    ],
  })
  const result = validateChaptersJson(text)
  assert.equal(result.ok, true)
  assert.equal(result.summary?.chapterCount, 3)
  assert.equal(result.summary?.lastStartSeconds, 720)
  assert.equal(result.summary?.version, '1.2.0')
  assert.deepEqual(result.summary?.titles, ['Intro', 'Topic one', 'Wrap-up'])
})

test('validateChaptersJson: invalid JSON', () => {
  const result = validateChaptersJson('{ bad json')
  assert.equal(result.ok, false)
  assert.match(result.errors[0], /Invalid JSON/)
})

test('validateChaptersJson: missing chapters array', () => {
  const result = validateChaptersJson(JSON.stringify({ version: '1.2.0' }))
  assert.equal(result.ok, false)
  assert.match(result.errors[0], /Missing or invalid `chapters` array/)
})

test('validateChaptersJson: chapter missing startTime', () => {
  const result = validateChaptersJson(JSON.stringify({ chapters: [{ title: 'Intro' }] }))
  assert.equal(result.ok, false)
  assert.match(result.errors[0], /startTime is missing/)
})

test('validateChaptersJson: out-of-order chapter flagged', () => {
  const result = validateChaptersJson(
    JSON.stringify({
      chapters: [
        { startTime: 0, title: 'A' },
        { startTime: 500, title: 'B' },
        { startTime: 100, title: 'C' },
      ],
    }),
  )
  assert.equal(result.ok, false)
  assert.match(result.errors.join(' '), /earlier than the previous chapter/)
})

test('validateChaptersJson: empty chapters array fails', () => {
  const result = validateChaptersJson(JSON.stringify({ chapters: [] }))
  assert.equal(result.ok, false)
  assert.match(result.errors[0], /Chapters array is empty/)
})

test('formatHms: under an hour shows M:SS', () => {
  assert.equal(formatHms(0), '0:00')
  assert.equal(formatHms(59), '0:59')
  assert.equal(formatHms(75), '1:15')
})

test('formatHms: at or over an hour shows H:MM:SS', () => {
  assert.equal(formatHms(3600), '1:00:00')
  assert.equal(formatHms(3725), '1:02:05')
})
