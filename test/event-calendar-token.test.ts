import { test } from 'node:test'
import assert from 'node:assert/strict'
import { signEventCalendarToken, verifyEventCalendarToken } from '../server/utils/event-calendar-token'

// The token IS the credential for an unauthenticated route, and it carries the
// disclosure flag as signed data — so the security property under test is that
// a link handed to a public channel can't be edited into one that reveals the
// recording room URL.
//
// Set before any sign/verify call rather than before the import: the module
// reads NUXT_SECRET_KEY lazily inside secret(), not at import time.
process.env.NUXT_SECRET_KEY = process.env.NUXT_SECRET_KEY || 'test-secret-for-calendar-tokens'

test('a signed token round-trips episode id and disclosure flag', () => {
  for (const include of [true, false]) {
    const parsed = verifyEventCalendarToken(signEventCalendarToken(42, include))
    assert.deepEqual(parsed, { episodeId: 42, includeRecordingLink: include })
  }
})

test('the two disclosure variants are different, non-interchangeable tokens', () => {
  const withLink = signEventCalendarToken(42, true)
  const without = signEventCalendarToken(42, false)
  assert.notEqual(withLink, without)
})

test('flipping the disclosure flag invalidates the signature', () => {
  // This is the whole point: a link posted in a public channel is `…-0-<sig>`,
  // and rewriting the 0 to a 1 must not produce a working link.
  const withheld = signEventCalendarToken(42, false)
  const tampered = withheld.replace(/^(\d+)-0-/, '$1-1-')
  assert.notEqual(tampered, withheld)
  assert.equal(verifyEventCalendarToken(tampered), null)
})

test('swapping in a different episode id invalidates the signature', () => {
  const token = signEventCalendarToken(42, true)
  const tampered = token.replace(/^42-/, '43-')
  assert.equal(verifyEventCalendarToken(tampered), null)
})

test('garbage and malformed tokens are rejected, not thrown on', () => {
  for (const bad of [
    '',
    'nope',
    '42',
    '42-1',
    '42-1-',
    '42-2-abcdefghijklmnopqrstuvwxy',
    '-1-1-abcdefghijklmnopqrstuvwxy',
    'abc-1-abcdefghijklmnopqrstuvwxy',
    '42-1-short',
    '42-1-' + 'a'.repeat(200),
  ]) {
    assert.equal(verifyEventCalendarToken(bad), null, `should reject: ${JSON.stringify(bad)}`)
  }
})

test('episode id 0 is rejected', () => {
  // Nothing legitimately signs id 0, and accepting it would make a
  // "test webhook" style placeholder resolve to a real lookup.
  assert.equal(verifyEventCalendarToken(signEventCalendarToken(0, true)), null)
})

test('a token signed under a different secret does not verify', async () => {
  const token = signEventCalendarToken(42, true)
  const original = process.env.NUXT_SECRET_KEY
  process.env.NUXT_SECRET_KEY = 'a-completely-different-secret'
  try {
    assert.equal(verifyEventCalendarToken(token), null)
  } finally {
    process.env.NUXT_SECRET_KEY = original
  }
})
