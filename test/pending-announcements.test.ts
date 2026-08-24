import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'

// Regression: firePublishEvent posted the Discord announcement in the same
// call that triggered the site build, so the linked episode page (built and
// rsynced by GitHub Actions minutes later) 404'd for anyone who clicked it
// immediately. Announcements are now parked in pending_announcements and
// released once the page answers 200 — or after deadline_at, with a warning.
//
// These pin the SQL contracts the release loop depends on. The probe itself
// (network) and delivery (webhooks) are covered by the endpoint-level code.

function makeDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(readFileSync('server/db/schema.sql', 'utf8'))
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (1, 'a@b.c', 'x')").run()
  db.prepare("INSERT INTO podcasts (id, slug, title) VALUES (1, 'ywiw', 'YWIW')").run()
  db.prepare("INSERT INTO episodes (id, podcast_id, title, slug, status) VALUES (1, 1, 'Ep', 'ep', 'published')").run()
  return db
}

const insert = (db: Database.Database, offsetMinutes: number) =>
  db.prepare(`
    INSERT OR REPLACE INTO pending_announcements
      (podcast_id, episode_id, probe_url, attempts, actor_user_id, deadline_at)
    VALUES (1, 1, 'https://ywiw.example/episodes/ep', 1, 1, datetime('now', ?))
  `).run(`${offsetMinutes} minutes`)

test('a fresh announcement is not yet expired', () => {
  const db = makeDb()
  insert(db, 30)
  const row = db.prepare(
    "SELECT datetime(deadline_at) <= datetime('now') AS expired FROM pending_announcements",
  ).get() as { expired: number }
  assert.equal(row.expired, 0, 'a 30-minute deadline should not read as expired on insert')
})

test('an announcement past its deadline reads as expired', () => {
  const db = makeDb()
  insert(db, -1)
  const row = db.prepare(
    "SELECT datetime(deadline_at) <= datetime('now') AS expired FROM pending_announcements",
  ).get() as { expired: number }
  assert.equal(row.expired, 1, 'a past deadline must release the announcement anyway')
})

test('re-publishing replaces the parked row instead of stacking a second one', () => {
  const db = makeDb()
  insert(db, 30)
  const first = db.prepare('SELECT deadline_at FROM pending_announcements').get() as { deadline_at: string }

  // Unpublish → republish. The UNIQUE(episode_id) + INSERT OR REPLACE must
  // re-arm the wait, not leave the stale deadline (or post twice).
  insert(db, 999)
  const rows = db.prepare('SELECT deadline_at FROM pending_announcements').all() as { deadline_at: string }[]
  assert.equal(rows.length, 1, 'a republish must not queue a second announcement for the same episode')
  assert.notEqual(rows[0].deadline_at, first.deadline_at, 'the deadline should be re-armed, not inherited')
})

test('deleting the episode clears its parked announcement', () => {
  const db = makeDb()
  insert(db, 30)
  db.prepare('DELETE FROM episodes WHERE id = 1').run()
  const rows = db.prepare('SELECT id FROM pending_announcements').all()
  assert.equal(rows.length, 0, 'ON DELETE CASCADE should drop the announcement with its episode')
})

test('deleting the podcast clears its parked announcements', () => {
  const db = makeDb()
  insert(db, 30)
  db.prepare('DELETE FROM podcasts WHERE id = 1').run()
  const rows = db.prepare('SELECT id FROM pending_announcements').all()
  assert.equal(rows.length, 0, 'purging a podcast should not leave orphaned announcements')
})

test('the actor FK survives user deletion so the release still audits', () => {
  const db = makeDb()
  insert(db, 30)
  db.prepare('DELETE FROM users WHERE id = 1').run()
  const row = db.prepare('SELECT actor_user_id FROM pending_announcements').get() as { actor_user_id: number | null }
  assert.equal(row.actor_user_id, null, 'ON DELETE SET NULL, not a cascade that would drop the announcement')
})
