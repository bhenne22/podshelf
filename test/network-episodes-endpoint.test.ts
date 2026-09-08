import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// GET /api/networks/[slug]/episodes is the "which episode is 975?" lookup —
// episode ids are global across podcasts and were otherwise only visible in a
// page URL. These pin the parts that make it useful and safe: the id has to be
// in the projection, and a scoped key must never be able to widen its view.
const src = readFileSync(
  resolve(__dirname, '..', 'server', 'api', 'networks', '[slug]', 'episodes.get.ts'),
  'utf-8',
)

function selectCols(): string[] {
  const m = src.match(/SELECT_COLS\s*=\s*`([^`]+)`/)
  assert.ok(m, 'SELECT_COLS should be extractable')
  return m![1].split(',').map((c) => c.trim()).filter(Boolean)
}

test('projection exposes the episode id', () => {
  const cols = selectCols()
  assert.ok(
    cols.some((c) => /\be\.id\b/.test(c) && /episode_id/.test(c)),
    `projection must expose e.id AS episode_id; got: ${cols.join(' | ')}`,
  )
})

test('projection carries what the list renders', () => {
  const cols = selectCols().join(' | ')
  for (const needed of [
    'episode_title', 'episode_slug', 'status', 'published_at',
    'season_number', 'episode_number',
    'podcast_slug', 'podcast_title', 'podcast_timezone',
  ]) {
    assert.ok(cols.includes(needed), `projection missing ${needed}`)
  }
})

test('scopes the query to the network via requireNetworkReadAccess', () => {
  assert.ok(
    src.includes('requireNetworkReadAccess'),
    'must go through requireNetworkReadAccess, not requireAuth',
  )
  assert.ok(
    src.includes('effectivePodcastIds'),
    'must filter by effectivePodcastIds so a scoped API key cannot widen its view',
  )
})

test('a ?podcast= outside the network returns nothing rather than the whole network', () => {
  // The guard reads: if (!row || !effectivePodcastIds.includes(row.id)) return empty.
  // Without the includes() half, an out-of-network slug would fall through and
  // list every episode in the network instead.
  assert.match(
    src,
    /!row\s*\|\|\s*!effectivePodcastIds\.includes\(row\.id\)/,
    'unknown or out-of-network podcast slug must short-circuit to an empty result',
  )
})

test('status filter is whitelisted', () => {
  assert.match(src, /VALID_STATUSES\s*=\s*\[\s*'draft',\s*'scheduled',\s*'published'\s*\]/)
  assert.ok(
    src.includes('VALID_STATUSES.includes(status)'),
    'status must be checked against the whitelist before reaching SQL',
  )
})

test('limit is bounded', () => {
  assert.match(src, /Math\.min\(Math\.max\(Number\(query\.limit\)\s*\|\|\s*100,\s*1\),\s*500\)/,
    'limit must be clamped so a caller cannot request the whole table')
})

test('user input reaches SQL only as bound parameters', () => {
  // Check the SQL actually handed to db.prepare(), not the whole file — the
  // LIKE term is legitimately built with a template literal, but as a bound
  // *value* (`%${term}%` pushed onto params), never as SQL text.
  const prepared = [...src.matchAll(/db\.prepare\(\s*`([\s\S]*?)`/g)].map((m) => m[1])
  assert.ok(prepared.length >= 2, 'expected the count query and the page query')
  for (const sql of prepared) {
    for (const interp of sql.match(/\$\{[^}]+\}/g) || []) {
      assert.ok(
        /^\$\{(SELECT_COLS|whereSql|idRank)\}$/.test(interp),
        `SQL may only interpolate vetted fragments; found ${interp}`,
      )
    }
  }
  // And each user-controlled filter must be bound, not inlined.
  assert.ok(src.includes('params.push(exactId, `%${term}%`)'), 'numeric id term must be bound')
  assert.ok(src.includes('params.push(status)'), 'status must be bound')
  // idRank is a fixed literal, and the id it compares against is still bound.
  assert.ok(
    src.includes("idRank = 'CASE WHEN e.id = ? THEN 0 ELSE 1 END,'"),
    'idRank must be a constant clause with a bound placeholder',
  )
  assert.ok(src.includes('orderParams.push(exactId)'), 'the ranked id must be bound')
})

test('an exact id match outranks title matches', () => {
  // Searching "1" matches every title containing the digit. Without this the
  // row the caller actually pasted an id for is buried mid-list.
  assert.ok(src.includes('CASE WHEN e.id = ?'), 'exact id must sort first')
  assert.ok(
    src.indexOf('${idRank}') < src.indexOf('COALESCE(e.published_at'),
    'the id rank must come before the date ordering',
  )
})
