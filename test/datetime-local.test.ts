import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  utcIsoToLocalInput,
  localInputToUtcIso,
} from '../utils/datetime-local'

// These tests pin the round-trip between datetime-local input strings (the
// "wall clock" the user sees) and UTC ISO timestamps (what the server
// stores). The helpers must respect the supplied IANA timezone, not the
// process's local timezone.

test('utcIsoToLocalInput renders UTC instant as wall clock in target zone', () => {
  // 2026-05-12T07:00:00Z is 00:00 PDT (LA, UTC-7 in May)
  assert.equal(
    utcIsoToLocalInput('2026-05-12T07:00:00.000Z', 'America/Los_Angeles'),
    '2026-05-12T00:00',
  )
  // Same instant in New York (UTC-4 in May, EDT)
  assert.equal(
    utcIsoToLocalInput('2026-05-12T07:00:00.000Z', 'America/New_York'),
    '2026-05-12T03:00',
  )
  // Same instant in UTC
  assert.equal(
    utcIsoToLocalInput('2026-05-12T07:00:00.000Z', 'UTC'),
    '2026-05-12T07:00',
  )
})

test('utcIsoToLocalInput returns "" for null/empty/garbage input', () => {
  assert.equal(utcIsoToLocalInput(null, 'UTC'), '')
  assert.equal(utcIsoToLocalInput(undefined, 'UTC'), '')
  assert.equal(utcIsoToLocalInput('', 'UTC'), '')
  assert.equal(utcIsoToLocalInput('not-a-date', 'UTC'), '')
})

test('localInputToUtcIso converts wall-clock-in-zone to UTC ISO', () => {
  // Midnight PDT → 07:00 UTC
  assert.equal(
    localInputToUtcIso('2026-05-12T00:00', 'America/Los_Angeles'),
    '2026-05-12T07:00:00.000Z',
  )
  // Midnight EDT → 04:00 UTC
  assert.equal(
    localInputToUtcIso('2026-05-12T00:00', 'America/New_York'),
    '2026-05-12T04:00:00.000Z',
  )
  // Midnight UTC → midnight UTC
  assert.equal(
    localInputToUtcIso('2026-05-12T00:00', 'UTC'),
    '2026-05-12T00:00:00.000Z',
  )
})

test('localInputToUtcIso handles standard-time zones (no DST in northern winter)', () => {
  // January 15 in NY is EST (UTC-5), not EDT
  assert.equal(
    localInputToUtcIso('2026-01-15T00:00', 'America/New_York'),
    '2026-01-15T05:00:00.000Z',
  )
})

test('localInputToUtcIso returns null for null/empty/malformed input', () => {
  assert.equal(localInputToUtcIso(null, 'UTC'), null)
  assert.equal(localInputToUtcIso(undefined, 'UTC'), null)
  assert.equal(localInputToUtcIso('', 'UTC'), null)
  assert.equal(localInputToUtcIso('garbage', 'UTC'), null)
  assert.equal(localInputToUtcIso('2026-05-12', 'UTC'), null) // missing time
})

test('round-trip is stable for arbitrary instants', () => {
  const cases = [
    { iso: '2026-05-12T07:00:00.000Z', tz: 'America/Los_Angeles' },
    { iso: '2026-01-15T05:00:00.000Z', tz: 'America/New_York' },
    { iso: '2026-08-01T22:00:00.000Z', tz: 'Asia/Tokyo' },
    { iso: '2026-12-31T23:30:00.000Z', tz: 'UTC' },
    { iso: '2026-06-30T12:00:00.000Z', tz: 'Europe/London' },
  ]
  for (const { iso, tz } of cases) {
    const local = utcIsoToLocalInput(iso, tz)
    const back = localInputToUtcIso(local, tz)
    // Round-trip is minute-precise (the input only carries minutes), so
    // back should equal the iso truncated to minute granularity.
    const isoMinute = iso.slice(0, 16) + ':00.000Z'
    assert.equal(back, isoMinute, `round-trip failed for ${iso} in ${tz}`)
  }
})
