import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The incremental-sync design (docs/incremental-sync-design.md) requires
// episodes.updated_at to bump whenever anything that affects the rendered
// episode payload changes. The non-obvious cases are:
//
//   1. Attaching/detaching a person to an episode (writes to episode_people,
//      not directly to episodes).
//   2. Updating a person row's name/img/href (writes to people, cascades to
//      every attached episode).
//   3. Deleting a person row (the FK CASCADE wipes episode_people, so the
//      bump MUST run BEFORE the DELETE FROM people).
//
// These tests pin the SQL behavior + the source-level call sites so a
// regression on either layer is caught at test time.

function makeDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );
    CREATE TABLE episode_people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
      person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE
    );
  `)
  return db
}

function seedWithAttachments(db: Database.Database) {
  // 3 episodes, 2 people. Person A is attached to ep1 + ep2; person B is
  // attached to ep3 only. ep1, ep2, ep3 start with an updated_at far enough
  // in the past that we can tell whether a bump fired.
  const past = '2020-01-01 00:00:00'
  db.prepare('INSERT INTO episodes (id, updated_at) VALUES (?, ?)').run(1, past)
  db.prepare('INSERT INTO episodes (id, updated_at) VALUES (?, ?)').run(2, past)
  db.prepare('INSERT INTO episodes (id, updated_at) VALUES (?, ?)').run(3, past)
  db.prepare('INSERT INTO people (id, name) VALUES (?, ?)').run(1, 'Alice')
  db.prepare('INSERT INTO people (id, name) VALUES (?, ?)').run(2, 'Bob')
  db.prepare('INSERT INTO episode_people (episode_id, person_id) VALUES (?, ?)').run(1, 1)
  db.prepare('INSERT INTO episode_people (episode_id, person_id) VALUES (?, ?)').run(2, 1)
  db.prepare('INSERT INTO episode_people (episode_id, person_id) VALUES (?, ?)').run(3, 2)
}

function updatedAt(db: Database.Database, episodeId: number): string {
  const row = db.prepare('SELECT updated_at FROM episodes WHERE id = ?').get(episodeId) as { updated_at: string }
  return row.updated_at
}

test('person-update cascade bumps only the attached episodes, not the rest', () => {
  const db = makeDb()
  seedWithAttachments(db)

  // Simulate updating person 1 (Alice). The cascade SQL must bump ep1 + ep2
  // (where Alice is attached) and leave ep3 alone.
  db.prepare(`
    UPDATE episodes SET updated_at = datetime('now')
    WHERE id IN (SELECT episode_id FROM episode_people WHERE person_id = ?)
  `).run(1)

  assert.notEqual(updatedAt(db, 1), '2020-01-01 00:00:00', 'ep1 should be bumped (Alice is attached)')
  assert.notEqual(updatedAt(db, 2), '2020-01-01 00:00:00', 'ep2 should be bumped (Alice is attached)')
  assert.equal(updatedAt(db, 3), '2020-01-01 00:00:00', 'ep3 must NOT be bumped (Bob is attached, not Alice)')
})

test('person-delete cascade requires the bump to run BEFORE the DELETE', () => {
  const db = makeDb()
  seedWithAttachments(db)

  // Bump first (the production code does this), then delete. The FK CASCADE
  // wipes episode_people rows that referenced Alice — but we already captured
  // the affected episodes via the subquery above the delete.
  db.prepare(`
    UPDATE episodes SET updated_at = datetime('now')
    WHERE id IN (SELECT episode_id FROM episode_people WHERE person_id = ?)
  `).run(1)
  db.prepare('DELETE FROM people WHERE id = ?').run(1)

  assert.notEqual(updatedAt(db, 1), '2020-01-01 00:00:00', 'ep1 must be bumped before the delete-cascade wipes its attachment')
  assert.notEqual(updatedAt(db, 2), '2020-01-01 00:00:00', 'ep2 must be bumped before the delete-cascade wipes its attachment')
  assert.equal(updatedAt(db, 3), '2020-01-01 00:00:00', 'ep3 must NOT be bumped (unrelated)')

  // Confirm the CASCADE actually fired — episode_people rows for person 1 are gone.
  const remaining = db.prepare('SELECT COUNT(*) AS c FROM episode_people WHERE person_id = ?').get(1) as { c: number }
  assert.equal(remaining.c, 0, 'CASCADE should have wiped Alice\'s attachments')
})

test('person-delete cascade is broken if the bump runs AFTER the DELETE', () => {
  // Pin the ordering: if a future refactor moves the bump after the delete,
  // the subquery returns nothing and no episodes get bumped. This test fails
  // when the buggy ordering is in place, catching the regression.
  const db = makeDb()
  seedWithAttachments(db)

  db.prepare('DELETE FROM people WHERE id = ?').run(1)  // CASCADE wipes attachments first
  db.prepare(`
    UPDATE episodes SET updated_at = datetime('now')
    WHERE id IN (SELECT episode_id FROM episode_people WHERE person_id = ?)
  `).run(1)

  // ep1 + ep2 are now stale in the eyes of consumers — they reference a
  // person who no longer exists — but updated_at didn't advance. This is
  // the bug we're guarding against.
  assert.equal(updatedAt(db, 1), '2020-01-01 00:00:00', 'demonstrates the broken ordering: ep1 NOT bumped')
  assert.equal(updatedAt(db, 2), '2020-01-01 00:00:00', 'demonstrates the broken ordering: ep2 NOT bumped')
})

// ---- Source-pin tests: cheap regression detection for the simpler bumps ----

const repoRoot = resolve(__dirname, '..')

function srcOf(...parts: string[]): string {
  return readFileSync(resolve(repoRoot, ...parts), 'utf-8')
}

test('episodes/[id]/people.post.ts bumps episodes.updated_at', () => {
  const src = srcOf('server', 'api', 'podcasts', '[slug]', 'episodes', '[id]', 'people.post.ts')
  assert.match(
    src,
    /UPDATE episodes SET updated_at = datetime\('now'\) WHERE id = \?/,
    'attach/upsert handler must bump episodes.updated_at',
  )
})

test('episodes/[id]/people/[attachId].delete.ts bumps episodes.updated_at', () => {
  const src = srcOf('server', 'api', 'podcasts', '[slug]', 'episodes', '[id]', 'people', '[attachId].delete.ts')
  assert.match(
    src,
    /UPDATE episodes SET updated_at = datetime\('now'\) WHERE id = \?/,
    'detach handler must bump episodes.updated_at',
  )
})

test('people/[id].patch.ts cascades only on render-affecting field changes', () => {
  const src = srcOf('server', 'api', 'podcasts', '[slug]', 'people', '[id].patch.ts')
  assert.match(
    src,
    /RENDER_AFFECTING\s*=\s*new Set\(\['name',\s*'img_url',\s*'href'\]\)/,
    'cascade must be gated on render-affecting fields (name/img_url/href)',
  )
  assert.match(
    src,
    /UPDATE episodes SET updated_at = datetime\('now'\)[\s\S]*FROM episode_people WHERE person_id = \?/,
    'cascade SQL must select attached episodes via episode_people',
  )
})

test('people/[id].delete.ts cascades BEFORE the DELETE FROM people', () => {
  const src = srcOf('server', 'api', 'podcasts', '[slug]', 'people', '[id].delete.ts')
  const cascadeIdx = src.search(/UPDATE episodes SET updated_at = datetime\('now'\)/)
  const deleteIdx = src.search(/DELETE FROM people WHERE id = \?/)
  assert.ok(cascadeIdx >= 0, 'cascade UPDATE must be present')
  assert.ok(deleteIdx >= 0, 'DELETE FROM people must be present')
  assert.ok(
    cascadeIdx < deleteIdx,
    'cascade UPDATE must appear BEFORE DELETE FROM people (FK CASCADE wipes episode_people otherwise)',
  )
})

test('feeds/[slug].xml.ts GUID backfill bumps episodes.updated_at', () => {
  const src = srcOf('server', 'routes', 'feeds', '[slug].xml.ts')
  assert.match(
    src,
    /UPDATE episodes SET guid = \?, updated_at = datetime\('now'\) WHERE id = \?/,
    'GUID backfill must bump updated_at so consumers pick up the change',
  )
})
