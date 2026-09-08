import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Database } from 'better-sqlite3'

// A pull-quote write should only cost a rebuild when it changes what a site
// build would actually render. Most writes don't: importing candidates,
// editing a pending one, deleting a bad one — all invisible downstream while
// the quote is unapproved.
//
// This is the one place in the suite that runs against a real SQLite file,
// because the behaviour under test is a before/after comparison of query
// results. Asserting on source text would pin the shape of the code without
// proving the comparison works.

let dbDir: string

before(() => {
  dbDir = mkdtempSync(join(tmpdir(), 'podshelf-pq-'))
  process.env.DATABASE_PATH = join(dbDir, 'test.db')
  // initDb() reaches for Nuxt's auto-imported useRuntimeConfig, which doesn't
  // exist outside Nitro. DATABASE_PATH above already takes precedence over the
  // config value, so an empty stub is enough to let the module load.
  ;(globalThis as unknown as { useRuntimeConfig: () => unknown }).useRuntimeConfig = () => ({})
})

after(() => {
  rmSync(dbDir, { recursive: true, force: true })
})

async function freshEpisode() {
  const { default: getDb } = await import('../server/db/index')
  const db = getDb()
  db.exec('DELETE FROM episode_pull_quotes; DELETE FROM episodes; DELETE FROM podcasts;')
  db.prepare("INSERT INTO podcasts (id, slug, title) VALUES (1, 'test', 'Test')").run()
  db.prepare("INSERT INTO episodes (id, podcast_id, title, slug, status) VALUES (1, 1, 'Ep', 'ep', 'published')").run()
  return db
}

function addQuote(db: Database, quote: string, position: number, approved: number): number {
  return Number(
    db.prepare(
      'INSERT INTO episode_pull_quotes (episode_id, quote, position, approved) VALUES (1, ?, ?, ?)',
    ).run(quote, position, approved).lastInsertRowid,
  )
}

test('adding an unapproved quote does not move the downstream payload', async () => {
  const db = await freshEpisode()
  const { approvedQuotesFingerprint } = await import('../server/utils/pull-quotes')

  const before = approvedQuotesFingerprint(1)
  addQuote(db, 'a pending candidate', 0, 0)
  assert.equal(approvedQuotesFingerprint(1), before,
    'an unapproved quote is invisible to a site build, so nothing should have changed')
})

test('approving a quote does move it', async () => {
  const db = await freshEpisode()
  const { approvedQuotesFingerprint } = await import('../server/utils/pull-quotes')

  const id = addQuote(db, 'a pending candidate', 0, 0)
  const before = approvedQuotesFingerprint(1)
  db.prepare('UPDATE episode_pull_quotes SET approved = 1 WHERE id = ?').run(id)
  assert.notEqual(approvedQuotesFingerprint(1), before, 'approval is what publishes a quote')
})

test('editing an unapproved quote does not move it; editing an approved one does', async () => {
  const db = await freshEpisode()
  const { approvedQuotesFingerprint } = await import('../server/utils/pull-quotes')

  const pending = addQuote(db, 'pending', 0, 0)
  const live = addQuote(db, 'live', 1, 1)

  let before = approvedQuotesFingerprint(1)
  db.prepare('UPDATE episode_pull_quotes SET quote = ? WHERE id = ?').run('pending, reworded', pending)
  assert.equal(approvedQuotesFingerprint(1), before, 'nobody downstream can see a pending quote')

  before = approvedQuotesFingerprint(1)
  db.prepare('UPDATE episode_pull_quotes SET quote = ? WHERE id = ?').run('live, reworded', live)
  assert.notEqual(approvedQuotesFingerprint(1), before, 'an approved quote is rendered, so an edit counts')
})

test('deleting a pending quote is free; deleting an approved one is not', async () => {
  const db = await freshEpisode()
  const { approvedQuotesFingerprint } = await import('../server/utils/pull-quotes')

  const pending = addQuote(db, 'pending', 0, 0)
  const live = addQuote(db, 'live', 1, 1)

  let before = approvedQuotesFingerprint(1)
  db.prepare('DELETE FROM episode_pull_quotes WHERE id = ?').run(pending)
  assert.equal(approvedQuotesFingerprint(1), before)

  before = approvedQuotesFingerprint(1)
  db.prepare('DELETE FROM episode_pull_quotes WHERE id = ?').run(live)
  assert.notEqual(approvedQuotesFingerprint(1), before)
})

test('reordering an unapproved quote past an approved one is not a downstream change', async () => {
  // The case that motivated comparing payloads instead of checking which
  // fields were touched: both rows get their position rewritten, but the
  // approved list is one item long and reads identically either way.
  const db = await freshEpisode()
  const { approvedQuotesFingerprint } = await import('../server/utils/pull-quotes')

  const pending = addQuote(db, 'pending', 0, 0)
  const live = addQuote(db, 'live', 1, 1)

  const before = approvedQuotesFingerprint(1)
  db.prepare('UPDATE episode_pull_quotes SET position = 1 WHERE id = ?').run(pending)
  db.prepare('UPDATE episode_pull_quotes SET position = 0 WHERE id = ?').run(live)
  assert.equal(approvedQuotesFingerprint(1), before,
    'positions changed but the approved list did not, so no rebuild is owed')
})

test('reordering two approved quotes IS a downstream change', async () => {
  const db = await freshEpisode()
  const { approvedQuotesFingerprint } = await import('../server/utils/pull-quotes')

  const first = addQuote(db, 'first', 0, 1)
  const second = addQuote(db, 'second', 1, 1)

  const before = approvedQuotesFingerprint(1)
  db.prepare('UPDATE episode_pull_quotes SET position = 1 WHERE id = ?').run(first)
  db.prepare('UPDATE episode_pull_quotes SET position = 0 WHERE id = ?').run(second)
  assert.notEqual(approvedQuotesFingerprint(1), before,
    'order is the contract for "top N quotes", so swapping two live ones matters')
})

test('syncEpisodeAfterQuoteWrite reports whether it did anything', async () => {
  const db = await freshEpisode()
  const { approvedQuotesFingerprint, syncEpisodeAfterQuoteWrite } =
    await import('../server/utils/pull-quotes')

  const before = approvedQuotesFingerprint(1)
  const id = addQuote(db, 'pending', 0, 0)
  assert.equal(
    syncEpisodeAfterQuoteWrite({ episodeId: 1, podcastId: 1, episodeStatus: 'published', before }),
    false,
    'an unapproved insert should report no downstream change',
  )

  const before2 = approvedQuotesFingerprint(1)
  db.prepare('UPDATE episode_pull_quotes SET approved = 1 WHERE id = ?').run(id)
  assert.equal(
    syncEpisodeAfterQuoteWrite({ episodeId: 1, podcastId: 1, episodeStatus: 'published', before: before2 }),
    true,
    'an approval should report a downstream change',
  )
})

test('updated_at only advances when the downstream payload moved', async () => {
  const db = await freshEpisode()
  const { approvedQuotesFingerprint, syncEpisodeAfterQuoteWrite } =
    await import('../server/utils/pull-quotes')

  db.prepare("UPDATE episodes SET updated_at = '2020-01-01 00:00:00' WHERE id = 1").run()
  const stamp = () => (db.prepare('SELECT updated_at FROM episodes WHERE id = 1').get() as { updated_at: string }).updated_at

  const before = approvedQuotesFingerprint(1)
  const id = addQuote(db, 'pending', 0, 0)
  syncEpisodeAfterQuoteWrite({ episodeId: 1, podcastId: 1, episodeStatus: 'published', before })
  assert.equal(stamp(), '2020-01-01 00:00:00',
    'an invisible change must not make the downstream sync re-fetch this episode')

  const before2 = approvedQuotesFingerprint(1)
  db.prepare('UPDATE episode_pull_quotes SET approved = 1 WHERE id = ?').run(id)
  syncEpisodeAfterQuoteWrite({ episodeId: 1, podcastId: 1, episodeStatus: 'published', before: before2 })
  assert.notEqual(stamp(), '2020-01-01 00:00:00', 'a visible change must bump the staleness signal')
})

// ---- The same rule on the episode row ----

test('private_notes is excluded from the rebuild trigger', () => {
  const src = readFileSync(
    resolve(__dirname, '..', 'server', 'api', 'podcasts', '[slug]', 'episodes', '[id].patch.ts'),
    'utf-8',
  )
  assert.match(src, /NON_RENDERED_FIELDS = new Set\(\['private_notes'\]\)/)
  assert.match(
    src,
    /wasOrIsPublished && renderedFieldChanged/,
    'a notes-only edit must not fire a rebuild',
  )
  // But it must still bump updated_at — that column is the human-facing
  // "last modified" too, and skipping it would make the UI lie.
  assert.match(src, /updates\.push\(`updated_at = datetime\('now'\)`\)/)
})
