import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'

// Regression: processScheduledFlips used `published_at <= datetime('now')`,
// which is a bytewise string compare in SQLite. Stored published_at values
// use a 'T' separator (either "...T00:00" from the form or
// "...T07:00:00.000Z" from new Date().toISOString()), while datetime('now')
// emits the canonical "YYYY-MM-DD HH:MM:SS" with a space. ASCII T (84) >
// space (32), so the predicate was always FALSE and scheduled episodes
// never auto-published. Wrapping both sides in datetime() forces SQLite
// to normalize formats before comparing.

function makeDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      published_at TEXT
    );
  `)
  return db
}

test('raw `<= datetime("now")` is broken for T-separator stored values', () => {
  const db = makeDb()
  const r1 = db.prepare("SELECT '2026-05-11T00:00' <= datetime('now') AS r").get() as { r: number }
  const r2 = db.prepare("SELECT '2026-05-11T00:00:00.000Z' <= datetime('now') AS r").get() as { r: number }
  // Both moments are clearly in the past, but bytewise compare says false.
  assert.equal(r1.r, 0, 'naked compare incorrectly says T00:00 form is NOT in the past')
  assert.equal(r2.r, 0, 'naked compare incorrectly says ISO-Z form is NOT in the past')
})

test('wrapping in datetime() fixes the comparison', () => {
  const db = makeDb()
  const r1 = db.prepare("SELECT datetime('2026-05-11T00:00') <= datetime('now') AS r").get() as { r: number }
  const r2 = db.prepare("SELECT datetime('2026-05-11T00:00:00.000Z') <= datetime('now') AS r").get() as { r: number }
  assert.equal(r1.r, 1, 'datetime()-wrapped compare correctly recognizes T00:00 form as past')
  assert.equal(r2.r, 1, 'datetime()-wrapped compare correctly recognizes ISO-Z form as past')
})

test('a future published_at is NOT selected when wrapped in datetime()', () => {
  const db = makeDb()
  // 100 years out, regardless of format.
  const future = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString()
  db.prepare('INSERT INTO episodes (published_at) VALUES (?)').run(future)
  const rows = db
    .prepare("SELECT id FROM episodes WHERE datetime(published_at) <= datetime('now')")
    .all() as { id: number }[]
  assert.equal(rows.length, 0, 'future-dated row should not match the flip predicate')
})

test('a past published_at IS selected when wrapped in datetime() — both storage formats', () => {
  const db = makeDb()
  // "Naive" form the deployed UI was producing: slice(0, 16) of an ISO.
  db.prepare('INSERT INTO episodes (published_at) VALUES (?)').run('2026-05-11T00:00')
  // Full ISO with Z that toISOString() produces.
  db.prepare('INSERT INTO episodes (published_at) VALUES (?)').run('2026-05-11T00:00:00.000Z')

  const rows = db
    .prepare("SELECT id FROM episodes WHERE datetime(published_at) <= datetime('now')")
    .all() as { id: number }[]
  assert.equal(rows.length, 2, 'both past rows should match regardless of stored format')
})
