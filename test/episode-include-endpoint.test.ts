import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Step 4 of the incremental-sync design (docs/incremental-sync-design.md):
// GET /api/podcasts/[slug]/episodes/[id]?include=chapters,transcript
// inlines the sidecar fetches into a single round trip. These tests pin
// the include-list parsing + the error-handling contract so a regression
// would surface here rather than in CI build logs.

const src = readFileSync(
  resolve(__dirname, '..', 'server', 'api', 'podcasts', '[slug]', 'episodes', '[id].get.ts'),
  'utf-8',
)

test('INCLUDE_VALUES whitelist names chapters + transcript + people', () => {
  const match = src.match(/INCLUDE_VALUES\s*=\s*new Set\(\[([^\]]+)\]\)/)
  assert.ok(match, 'INCLUDE_VALUES Set literal should be extractable')
  const values = new Set(
    match![1].split(',').map((s) => s.replace(/['"`\s]/g, '')).filter(Boolean),
  )
  assert.ok(values.has('chapters'), 'INCLUDE_VALUES must contain "chapters"')
  assert.ok(values.has('transcript'), 'INCLUDE_VALUES must contain "transcript"')
  assert.ok(values.has('people'), 'INCLUDE_VALUES must contain "people"')
})

test('include=people inlines a JOIN over episode_people + people', () => {
  // People is a local DB join — no HTTP fetch, no _warnings, no timeout.
  // Pin the projection so it stays in lockstep with the standalone
  // /episodes/[id]/people endpoint.
  assert.match(
    src,
    /if \(include\.has\('people'\)\) \{[\s\S]+?FROM episode_people ep[\s\S]+?JOIN people p ON p\.id = ep\.person_id/,
    'people include must JOIN episode_people with people',
  )
})

test('parseInclude rejects unknown include values with 400', () => {
  assert.match(
    src,
    /throw createError\(\{\s*statusCode:\s*400,\s*statusMessage:\s*`unknown include/,
    'parseInclude must reject unknown values with a 400',
  )
})

test('handler returns the bare episode when ?include= is absent', () => {
  // Backwards-compat: callers that don't ask for sidecars get today's
  // response shape unchanged.
  assert.match(
    src,
    /if \(include\.size === 0\) return episode/,
    'empty include set must short-circuit to the bare episode row',
  )
})

test('sidecar fetch is bounded by a timeout', () => {
  // 10 s timeout via AbortController — a slow storage origin can't hang the
  // build forever.
  assert.match(
    src,
    /SIDECAR_TIMEOUT_MS\s*=\s*10_?000/,
    'sidecar fetch must use a 10s timeout constant',
  )
  assert.match(
    src,
    /AbortController/,
    'sidecar fetch must use AbortController for cancellation',
  )
})

test('fetch failures populate _warnings instead of throwing', () => {
  // The non-fatal-warning contract is what makes builds robust: one
  // missing transcript shouldn't kill a 484-episode rebuild.
  assert.match(
    src,
    /warnings\.push\(`chapters:/,
    'chapters fetch failure must push to warnings',
  )
  assert.match(
    src,
    /warnings\.push\(`transcript:/,
    'transcript fetch failure must push to warnings',
  )
  assert.match(
    src,
    /if \(warnings\.length > 0\) result\._warnings = warnings/,
    'collected warnings must be exposed under _warnings on the response',
  )
})

test('transcript_path can be relative — resolved against SITE_URL', () => {
  // Legacy import shape: some podcasts store transcript_path as a path
  // like /podcastepisodes/foo.vtt. The handler resolves it against the
  // Podshelf instance's own SITE_URL before fetching.
  assert.match(
    src,
    /function resolveSidecarUrl\(/,
    'resolveSidecarUrl helper must exist',
  )
  assert.match(
    src,
    /if \(\/\^https\?:\\\/\\\/\/i\.test\(pathOrUrl\)\) return pathOrUrl/,
    'resolveSidecarUrl must pass absolute URLs through unchanged',
  )
  assert.match(
    src,
    /process\.env\.SITE_URL/,
    'resolveSidecarUrl must read SITE_URL for relative paths',
  )
})

test('chapters response is the parsed JSON body (not just the chapters array)', () => {
  // Letting consumers see the full Podcasting 2.0 chapters JSON
  // (`{ version, chapters: [...] }`) keeps them free to apply their own
  // formatting. Don't pre-extract.
  assert.match(
    src,
    /result\.chapters = JSON\.parse\(fetched\.body\)/,
    'chapters must be inlined as parsed JSON, not pre-extracted',
  )
})

test('transcript response carries { type, content }', () => {
  // type lets consumers pick the right parser (SRT vs VTT vs JSON).
  assert.match(
    src,
    /result\.transcript = \{\s*type:.+\s*content:/,
    'transcript must inline as { type, content }',
  )
})
