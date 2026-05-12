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

function extractDefaultCols(): string[] {
  const match = listSrc.match(/DEFAULT_SELECT_COLS\s*=\s*`([^`]+)`/)
  assert.ok(match, 'DEFAULT_SELECT_COLS string should be extractable')
  return match![1].split(',').map((c) => c.trim()).filter(Boolean)
}

function extractAllowedFields(): Set<string> {
  const match = listSrc.match(/ALLOWED_FIELDS\s*=\s*new Set\(\[([\s\S]+?)\]\)/)
  assert.ok(match, 'ALLOWED_FIELDS Set literal should be extractable')
  const fields = match![1]
    .split(',')
    .map((s) => s.replace(/['"`\s]/g, ''))
    .filter(Boolean)
  return new Set(fields)
}

test('LIST endpoint DEFAULT_SELECT_COLS includes guid', () => {
  const cols = extractDefaultCols()
  assert.ok(cols.includes('guid'), `LIST default projection must include guid; got: ${cols.join(', ')}`)
})

test('LIST default projection is a subset of (or equal to) SINGLE projection', () => {
  // Soft check — both endpoints should at minimum agree on shared fields.
  // Single endpoint uses SELECT * style or an explicit list; this catches
  // drift if someone adds a column to one and forgets the other.
  const listCols = new Set(extractDefaultCols())

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

// ---- ?fields= projection (incremental-sync design step 3) ----

test('ALLOWED_FIELDS covers every column in DEFAULT_SELECT_COLS', () => {
  // Drift guard: if you add a column to the default projection but forget
  // to whitelist it in ALLOWED_FIELDS, ?fields=<new-col> would 400 — which
  // is silently a worse default than failing the test.
  const defaultCols = extractDefaultCols()
  const allowed = extractAllowedFields()
  for (const col of defaultCols) {
    assert.ok(
      allowed.has(col),
      `column "${col}" is in DEFAULT_SELECT_COLS but missing from ALLOWED_FIELDS`,
    )
  }
})

test('ALLOWED_FIELDS includes the incremental-sync minimum projection', () => {
  // Downstream sync scripts hit ?fields=id,slug,updated_at,deleted_at,...
  // for the lightweight index. Pin those exact names so a column rename
  // upstream doesn't silently break the sync.
  const allowed = extractAllowedFields()
  for (const f of ['id', 'slug', 'updated_at']) {
    assert.ok(allowed.has(f), `incremental-sync requires "${f}" in ALLOWED_FIELDS`)
  }
})

test('resolveSelectCols rejects unknown fields with 400', () => {
  // Source-pin: the handler must throw createError({ statusCode: 400, ... })
  // on an unknown field. Catching this at lint-time means callers can rely
  // on typos being loud rather than silently returning empty projections.
  assert.match(
    listSrc,
    /throw createError\(\{\s*statusCode:\s*400,\s*statusMessage:\s*`unknown field/,
    'resolveSelectCols must reject unknown fields with a 400',
  )
})

test('resolveSelectCols returns the default projection on missing fields', () => {
  // Backwards-compat: callers that don't pass ?fields= keep getting
  // everything, same as today's behavior.
  assert.match(
    listSrc,
    /if \(!fieldsParam\) return DEFAULT_SELECT_COLS/,
    'resolveSelectCols must fall back to DEFAULT_SELECT_COLS when ?fields= is absent',
  )
})
