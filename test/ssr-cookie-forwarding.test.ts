import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

/**
 * A top-level `await` in <script setup> runs during SSR too, and plain $fetch
 * carries no cookies on the server — so any authenticated endpoint it calls
 * comes back 401.
 *
 * This shipped, and it was bad in two different ways:
 *
 *   - components/PublishPendingBanner.vue caught the 401 and, matching
 *     middleware/auth.ts's "only a 401 means logged out" rule, redirected to
 *     /login. The banner renders whenever AdminNav has a podcastSlug, so every
 *     server-rendered /podcasts/* page bounced a logged-in user to the login
 *     screen. In-app navigation hid it completely, because there $fetch runs in
 *     the browser and cookies are attached automatically.
 *   - composables/useEpisodes.ts, and the audit / people / distribution pages,
 *     rendered the raw error instead:
 *     `[GET] "/api/podcasts/…": 401 Unauthorized`.
 *
 * The fix is `headers: useRequestHeaders(['cookie'])`, captured in setup
 * context. This test pins it: if a page or component awaits at the top level
 * and anything it reaches uses $fetch, cookie forwarding has to be present.
 */

const ROOT = resolve(__dirname, '..')

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(vue|ts)$/.test(entry)) out.push(full)
  }
  return out
}

/**
 * Strip comments before matching. Without this the check passes on a file that
 * merely *mentions* useRequestHeaders in a comment explaining the fix — which
 * is exactly what happened when this test was first written.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** Composable source for every `useXxx(` referenced by the file (auto-imported). */
function composableSources(src: string): string {
  let combined = ''
  for (const m of src.matchAll(/\b(use[A-Z][A-Za-z0-9]*)\s*\(/g)) {
    const path = join(ROOT, 'composables', `${m[1]}.ts`)
    if (existsSync(path)) combined += readFileSync(path, 'utf-8')
  }
  return combined
}

/**
 * Does this file run a fetch as part of setup (and therefore during SSR)?
 *
 * Two shapes count, both unambiguous:
 *   - a column-0 `await` — top-level setup code;
 *   - a column-0 `try {` whose body awaits — how the preview pages load.
 *
 * `await useFetch(...)` / `await useAsyncData(...)` are excluded: those are
 * SSR-aware and forward cookies themselves. Only bare $fetch is the problem.
 */
function awaitsAtSetup(src: string): boolean {
  const topLevelAwait = src
    .split('\n')
    .some((l) => /^await\s/.test(l) && !/^await\s+(useFetch|useAsyncData)\b/.test(l))
  if (topLevelAwait) return true

  const tryBlock = src.match(/^try \{\n([\s\S]*?)^\}/m)
  return !!tryBlock && /\bawait\b/.test(tryBlock[1])
}

const files = [...walk(join(ROOT, 'pages')), ...walk(join(ROOT, 'components'))]

test('there are page/component files to inspect', () => {
  assert.ok(files.length > 10, `expected to find Vue files; got ${files.length}`)
})

test('every SSR-time fetch forwards the session cookie', () => {
  const offenders: string[] = []

  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf-8'))
    if (!awaitsAtSetup(src)) continue

    const reachable = src + composableSources(src)
    if (!reachable.includes('$fetch')) continue
    if (/=\s*useRequestHeaders\(/.test(reachable)) continue

    offenders.push(file.slice(ROOT.length + 1))
  }

  assert.deepEqual(
    offenders,
    [],
    'these run a bare $fetch during SSR without forwarding the session cookie, ' +
      'so it 401s on the server:\n  ' + offenders.join('\n  '),
  )
})

test('PublishPendingBanner forwards cookies — it caused the /login bounce', () => {
  const src = readFileSync(join(ROOT, 'components', 'PublishPendingBanner.vue'), 'utf-8')
  assert.ok(src.includes("useRequestHeaders(['cookie'])"), 'must capture the cookie header')
  assert.match(
    src,
    /publish-status`,\s*\n\s*\{ headers: ssrHeaders \},/,
    'the publish-status fetch must send the captured headers',
  )
  // The 401 -> /login branch is correct behaviour and should stay; it was the
  // missing cookie that made it fire for logged-in users.
  assert.ok(src.includes("navigateTo('/login')"), 'the genuine-401 redirect should remain')
})

test('useRequestHeaders is captured in setup, not inside a callback', () => {
  // useRequestHeaders is a composable: calling it inside setInterval or an
  // event handler is outside setup context. Every call must be a top-level
  // `const ... = useRequestHeaders(...)` binding.
  for (const file of files.concat(walk(join(ROOT, 'composables')))) {
    const src = readFileSync(file, 'utf-8')
    for (const line of src.split('\n')) {
      if (!line.includes('useRequestHeaders(')) continue
      assert.match(
        line.trim(),
        /^(?:\/\/.*|const\s+\w+\s*=\s*useRequestHeaders\(.*)$/,
        `${file.slice(ROOT.length + 1)}: useRequestHeaders must be bound in setup, got: ${line.trim()}`,
      )
    }
  }
})
