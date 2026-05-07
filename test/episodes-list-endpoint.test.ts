import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Bug 4: GET /api/podcasts/{slug}/episodes used to omit `guid` from its
// projection while GET .../episodes/{id} included it, leading audit
// scripts to falsely conclude no episodes had GUIDs. This test pins the
// SELECT projection so a regression is caught at lint-time, not in prod.
const listSrc = readFileSync(
  resolve(__dirname, '..', 'server', 'api', 'podcasts', '[slug]', 'episodes', 'index.get.ts'),
  'utf-8',
)
const singleSrc = readFileSync(
  resolve(__dirname, '..', 'server', 'api', 'podcasts', '[slug]', 'episodes', '[id].get.ts'),
  'utf-8',
)

test('LIST endpoint SELECT_COLS includes guid', () => {
  const match = listSrc.match(/SELECT_COLS\s*=\s*`([^`]+)`/)
  assert.ok(match, 'SELECT_COLS string should be extractable')
  const cols = match![1]
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
  assert.ok(cols.includes('guid'), `LIST projection must include guid; got: ${cols.join(', ')}`)
})

test('LIST projection is a subset of (or equal to) SINGLE projection', () => {
  // Soft check — both endpoints should at minimum agree on shared fields.
  // Single endpoint uses SELECT * style or an explicit list; this catches
  // drift if someone adds a column to one and forgets the other.
  const listMatch = listSrc.match(/SELECT_COLS\s*=\s*`([^`]+)`/)
  const listCols = new Set(
    listMatch![1].split(',').map((c) => c.trim()).filter(Boolean),
  )

  // The single-episode endpoint may use SELECT *; if so we skip diffing.
  // If it uses an explicit list, every LIST column should appear in it.
  const singleMatch = singleSrc.match(/SELECT\s+(\*|[^F]+?)\s+FROM\s+episodes/i)
  if (!singleMatch || singleMatch[1].trim() === '*') return
  const singleCols = new Set(
    singleMatch[1].split(',').map((c) => c.trim()).filter(Boolean),
  )
  for (const col of listCols) {
    assert.ok(
      singleCols.has(col),
      `column "${col}" is in LIST projection but missing from SINGLE projection`,
    )
  }
})
