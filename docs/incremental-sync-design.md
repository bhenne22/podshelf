# Incremental sync — design

Design doc for cutting downstream Nuxt site build time by reducing Podshelf API
calls from ~114-per-show-per-build to ~5-per-show-per-build (and ~2 for the common
"one episode just published" case).

Status: design, not yet implemented. Supersedes the *Selective Podshelf sync on
dispatch* entry in `teampumaknife.com/docs/enhancements.md`.

## Goals

- **Reduce API calls per build to a small constant for the common case.** Today
  every CI build re-fetches everything for every show even when nothing changed.
  Target: ~5 HTTP calls per show on a no-changes build; ~2 additional calls per
  changed episode.
- **Keep CI runtime well under GitHub Actions free-tier limits at any plausible
  network size.** Today's TPK build does ~900 HTTP calls + ~13 s prerender across
  8 shows. The prerender side is already fast; sync is the slow piece. We want
  even a network of 50 shows / 2 000 episodes to fit in single-digit-second sync.
- **Be self-healing.** Any CI run from a clean checkout, after a cache miss,
  after a manual `workflow_dispatch`, or after recovery from a failed deploy
  should converge to correct content without operator intervention.
- **No new persistent state outside the existing repos.** No cursor in a database,
  no commit-back from CI to repos, no GitHub Actions cache dependency.
- **Backwards-compatible.** Existing full-sync code path stays as the fallback;
  consumers opt in to incremental.

## Non-goals

- Streaming live updates to a running site. The Nuxt sites are static — the
  build is the only consumer.
- Cache invalidation for served listener traffic. That's a different layer
  (DreamHost `Cache-Control` headers + feed `lastBuildDate`); unaffected here.
- Replacing the dispatch chain. `repository_dispatch` events still trigger
  builds the same way; this design only changes what the sync script does once
  the build starts.

## Current state (and where the cost lives)

Per build of one show today (`scripts/sync.mjs` in ys100m / ywiw; multiplied
across 8 shows in `scripts/sync-podshelf.mjs` for TPK):

| Call | Per show | Notes |
|---|---|---|
| `GET /api/podcasts/<slug>` | 1 | Show metadata |
| `GET /api/podcasts/<slug>/distribution` | 1 | "Listen on" destinations |
| `GET /api/podcasts/<slug>/episodes` | 1 | Returns full list with full descriptions and tags inline |
| `GET <chapters_url>` (per episode w/ chapters) | ~N | One per episode that has chapters |
| `GET <transcript_path>` (per episode w/ transcript) | ~N | One per episode that has a transcript |
| `GET /feeds/<slug>.xml` | 1 | RSS mirror |
| Per-episode `people` projection | ~N | If sync fetches per-episode (varies by consumer) |

For an 8-show network with ~60 episodes per show and transcripts everywhere:
roughly **900 HTTP round trips per CI run**. Every CI run. Even for a no-op push.
And **every byte of those 900 calls** is the same as what's already committed to
the repo in `content/episodes/*.md` — there's a 484-file episode cache sitting
right there in git that the sync script ignores.

## Approach — stateless incremental via `?fields=` + `?include=`

Two-prong:

1. **The repo's `content/` directory is the cache.** All three consumer sites
   already git-track `content/episodes/*.md`. The sync script reads what's
   already on disk, asks Podshelf for a lightweight index, and fetches *only
   what's stale*.
2. **One round trip per episode, not three.** Podshelf grows an `?include=`
   query param on the episode detail endpoint so chapters + transcript come
   inline. This collapses the per-changed-episode work from N+2 calls to 1.

No cursor, no server-side delta computation, no commit-back from CI. The
filesystem state IS the cursor.

### High-level sync algorithm

```text
GET /api/podcasts/<slug>/episodes?fields=id,slug,updated_at,deleted_at
        ↓ lightweight index (~50 KB even at 500 episodes)

For each row in index:
    on-disk = read content/episodes/<slug>.md frontmatter (if it exists)
    if on-disk.updated_at < index.updated_at  OR  on-disk missing:
        → mark for upsert
    else:
        → leave alone (no HTTP call)

For each marked-for-upsert episode:
    GET /api/podcasts/<slug>/episodes/<id>?include=chapters,transcript
        ↓ episode + chapters JSON + transcript SRT/VTT in one response

Delete: any content/episodes/<file>.md whose slug isn't in the index
GET    /api/podcasts/<slug>             → write content/shows/<slug>.md if changed
GET    /api/podcasts/<slug>/distribution → write distribution if changed
GET    /feeds/<slug>.xml                 → write feed mirror (always, cheap)
```

Common case (one episode just published in a 60-episode show):

| Call | Count |
|---|---|
| Episodes index | 1 |
| Episode detail w/ includes (only the new one) | 1 |
| Podcast meta | 1 |
| Distribution | 1 |
| Feed XML | 1 |
| **Total** | **5** |

For TPK with `SYNC_ONLY_SHOW` set from the dispatch payload, that's **5 calls
per build**, down from ~114. For TPK building all 8 shows (manual rebuild),
that's 8 × 5 = 40 calls down from ~900. Worst case (first build, empty content
dir, 60 fresh episodes): 1 + 60 + 3 = 64 calls. Still under today's per-show cost.

## Podshelf API changes

### 1. `?fields=` projection on episodes index

`GET /api/podcasts/<slug>/episodes?fields=id,slug,updated_at,deleted_at`

Adds a comma-separated whitelist filter to the existing handler at
`server/api/podcasts/[slug]/episodes/index.get.ts`. Implementation: parse + filter
against the existing `SELECT_COLS` column list, build a dynamic SELECT.
Unrecognized fields → 400. Empty / missing `fields` → today's full projection
(no behavior change).

Sketch:

```ts
const ALLOWED_FIELDS = new Set([
  'id', 'podcast_id', 'title', 'slug', 'episode_number', 'season_number',
  'description', 'descriptionPlain', 'audio_url', 'audio_filename',
  'audio_size_bytes', 'audio_duration_seconds', 'image_url', 'image_filename',
  'published_at', 'status', 'tags', 'guid',
  'transcript_path', 'transcript_type', 'chapters_url', 'episode_type',
  'itunes_title', 'itunes_author', 'itunes_explicit',
  'season_name', 'episode_display',
  'license_identifier', 'license_url',
  'created_at', 'updated_at', 'deleted_at',
])

const requested = (query.fields as string | undefined)?.split(',').map(s => s.trim())
if (requested) {
  for (const f of requested) {
    if (!ALLOWED_FIELDS.has(f)) {
      throw createError({ statusCode: 400, statusMessage: `unknown field: ${f}` })
    }
  }
}
const SELECT_COLS = requested?.length ? requested.join(', ') : DEFAULT_COLS
```

Test: hand-pick a single field, confirm only that column is returned. Pin
projection shape so adding columns to the table doesn't accidentally widen the
default response.

### 2. `?include=` on episode detail

`GET /api/podcasts/<slug>/episodes/<id>?include=chapters,transcript`

Returns the existing episode payload with two extra optional keys:

```json
{
  "id": 42, "title": "…", "…": "…",
  "chapters": [{ "startTime": 0, "title": "Intro" }, …],   // when ?include=chapters
  "transcript": {
    "type": "text/srt",
    "content": "1\n00:00:00.000 --> 00:00:04.500\n…"
  }                                                          // when ?include=transcript
}
```

Implementation notes:
- Today's `chapters_url` and `transcript_path` are URLs into the podcast's storage
  (SFTP/S3). The handler fetches those URLs server-side and inlines the bodies.
  That's one fewer round-trip for the consumer at the cost of one server-side
  fetch per request — net win because Podshelf's connection to storage is faster
  than CI → Podshelf → storage.
- Cache per-request: if a single CI run hits the same chapters URL twice, dedupe
  at the storage-fetch layer. Probably not worth optimizing on day one.
- Size budget: chapters JSON is small (~1 KB typical). Transcripts can be large
  (~50 KB for an hour-long episode VTT). Still well under HTTP body limits.
- If `chapters_url` is null, `chapters` is omitted (not `null` — omitted, so the
  consumer can tell "unknown" from "fetched and confirmed empty"). Same for
  transcript.
- Errors fetching the sidecar: return the episode with the sidecar key omitted
  and a top-level `_warnings: ["chapters: 404 from storage"]` so consumers can
  log without failing.

### 3. Close the `updated_at` gaps

Audit and fix:

- **`server/api/podcasts/[slug]/episodes/[id]/people.post.ts`** — attach/detach
  must bump `episodes.updated_at`. Add `UPDATE episodes SET updated_at = datetime('now') WHERE id = ?`
  in the same transaction as the `episode_people` write.
- **`server/api/podcasts/[slug]/people/[id].patch.ts`** — updating a person
  (name, photo, href) should bump `updated_at` on every episode that person is
  attached to. Add `UPDATE episodes SET updated_at = datetime('now') WHERE id IN (SELECT episode_id FROM episode_people WHERE person_id = ?)`.
- **Audit pass**: any other write that affects the rendered episode payload but
  doesn't touch `episodes` directly — same pattern.

This is the load-bearing invariant of the whole design: **if it changes the
rendered episode, it bumps `episodes.updated_at`.** Worth a comment block on
the table definition in `schema.sql` calling it out.

### 4. Show + distribution endpoints — already small, no changes needed

`GET /api/podcasts/<slug>` and `GET /api/podcasts/<slug>/distribution` are
single-digit-KB responses. The sync script fetches both unconditionally and
diffs against on-disk content. Fast enough; not worth a "since" param.

Optional later refinement: surface `updated_at` on the podcast row in the API
projection so consumers can skip the write step when unchanged. Trivial; defer.

### 5. Feed XML — no changes

The feed mirror is fetched once per show per build (one HTTP call, one file
write). Already cheap; leave alone.

## Consumer (sync script) algorithm

Pseudocode — applies to all three consumer sites (TPK loops outer over shows;
sister sites have only one show):

```ts
async function syncShow(slug) {
  // 1. Index — single call, ~50 KB payload, no episode bodies
  const index = await fetch(`/api/podcasts/${slug}/episodes?fields=id,slug,updated_at,deleted_at`)

  // 2. Reconcile against disk
  const onDisk = readDir(`content/episodes/`).map(readFrontmatter)
  const bySlug = new Map(onDisk.map(e => [e.slug, e]))

  const upserts = []
  const keep = new Set()

  for (const row of index) {
    if (row.deleted_at) continue
    keep.add(row.slug)
    const existing = bySlug.get(row.slug)
    if (!existing || existing.updated_at < row.updated_at) {
      upserts.push(row.id)
    }
  }

  // 3. Detail fetches — one round trip per changed episode, sidecars inlined
  for (const id of upserts) {
    const detail = await fetch(`/api/podcasts/${slug}/episodes/${id}?include=chapters,transcript`)
    writeEpisode(detail)                       // content/episodes/<slug>.md
    if (detail.transcript) writeTranscript(detail)  // public/transcripts/<slug>.json
  }

  // 4. Prune
  for (const file of onDisk) {
    if (!keep.has(file.slug)) {
      rmEpisode(file)
      rmTranscript(file)
    }
  }

  // 5. Always-refresh small payloads
  writeShow(await fetch(`/api/podcasts/${slug}`))                    // content/shows/<slug>.md
  writeDistribution(await fetch(`/api/podcasts/${slug}/distribution`))
  writeFeed(await fetch(`/feeds/${slug}.xml`))                       // public/feed/<feedSlug>/index.xml
}
```

Notes:

- **Always-fresh fields** (TPK's `mergeWrite` alwaysFresh list) continue to win
  over local edits, since the .md gets rewritten on upsert. No behavior change
  on that front.
- **Hand-annotated fields** (`guest`, `tags` in sister sites; varies in TPK)
  survive across the rewrite via existing merge logic. No change.
- **Local timestamps**: episodes' frontmatter `updated_at` must be written in
  the same format Podshelf emits (ISO 8601 UTC) so the `<` comparison is correct.
  Today's sync writes a Date object; need to standardize on strings.
- **Manual `workflow_dispatch`** triggers the same code path. No fallback path
  is needed — the algorithm self-heals from any state.
- **`SYNC_ONLY_SHOW` env var** (the existing selective-sync plan) still applies:
  on a Podshelf dispatch with `client_payload.slug`, only that show gets the
  inner loop. Outside shows are skipped entirely (no index call) because their
  state in `content/` is known good.

## Cost analysis

Per-build HTTP calls, by scenario:

| Scenario | Today | With this design |
|---|---|---|
| **TPK rebuild from Podshelf dispatch** (1 episode published in 1 show, 8 shows in network) | ~900 (full sync of all 8 shows) | **5** (only the dispatched show touched, 1 episode upsert) |
| **TPK rebuild from `child-site-updated` dispatch** (same as above, forwarded) | ~900 | **5** |
| **TPK manual `workflow_dispatch`** (no payload — refresh everything) | ~900 | **40** (5 per show × 8 shows, no episodes need upsert) |
| **TPK first build / empty content dir** (cold cache) | ~900 | **~485** (1 index + ~484 episode details + 3 small) |
| **Sister site rebuild from Podshelf dispatch** (1 episode just published) | ~114 | **5** |
| **Sister site rebuild from cosmetic push** (no episode change) | ~114 | **4** (index + 3 small; no detail fetches) |

CI wall-clock: today's ~13 s of prerender is unchanged. Sync time drops from
roughly 30-60 s (network round-trips dominated) to 1-3 s. Total CI runtime for
a typical Podshelf-triggered build: today ~90 s → with this design ~30 s.
GitHub Actions free-tier headroom comfortably restored.

## Failure modes & fallbacks

| Mode | Behavior |
|---|---|
| Podshelf is down at sync time | Build fails (same as today). Retry the workflow run. |
| `?fields=` returns 400 (unknown field) | Build fails loudly — schema drift. Fix the projection list and resync. |
| `?include=` fetch fails for one episode's sidecar | Episode upserts with sidecar omitted; `_warnings` logged; build continues. Next build retries (sidecar URL still in `chapters_url` / `transcript_path`). |
| Local `.md` has a malformed `updated_at` | Sync treats it as `0` → forces an upsert. Self-healing. |
| Two builds run concurrently | Each reads same git state, asks Podshelf same questions, produces identical results. Deploy step is the only mutation outside the runner; lftp `--only-newer --delete` is idempotent. Adding `concurrency: { group: deploy }` to each workflow is a tiny follow-up that prevents wasted runs but isn't required for correctness. |
| Person update without a person-update endpoint hook | Caught by the gap-closure work in §3 above — required for correctness. |
| `SYNC_ONLY_SHOW` set to a slug the build doesn't know about | Today's behavior preserved: warn + fall back to full sync (full sync is now cheap anyway). |

## Migration plan

Ordered for risk minimization. Each step ships independently.

### Step 1 — Close the `updated_at` gaps in Podshelf

Smallest blast radius. No consumer-visible behavior change; just makes the
existing `updated_at` column trustworthy. Tests: pin the `updated_at` bump in
people.post.ts and people/[id].patch.ts via the existing `node:test` setup.

### Step 2 — Idempotent sync (no Podshelf API changes)

In each consumer site's sync script:

1. Read existing `.md` frontmatter before fetching the index (already happening
   in TPK's `mergeWrite`; just lift the read up).
2. Skip the per-episode detail / chapter / transcript HTTP calls when the index
   row's `updated_at` matches the on-disk value.
3. Still fetches full bodies in the index payload (today's API), so per-call
   cost is unchanged — but eliminates the chapter + transcript fetches for
   unchanged episodes.

Expected savings: ~70% of today's calls. Lands without any Podshelf change.

### Step 3 — Ship `?fields=` projection on Podshelf

Adds the lightweight index. Consumer sync scripts opt in by switching the
listing fetch to `?fields=id,slug,updated_at,deleted_at`. Per-call cost drops
~95% on the listing.

### Step 4 — Ship `?include=` on episode detail

Collapses 3 calls per upserted episode (detail + chapters + transcript) into 1.
Consumer sync scripts switch their detail fetch to include sidecars.

### Step 5 — Wire `SYNC_ONLY_SHOW` into the dispatch flow

The selective-sync plan from `enhancements.md`, unchanged. With this design
already shipped, the dispatch-targeted show goes through the full new algorithm
(5 calls), and the un-dispatched shows are skipped entirely (0 calls).

## Testing

- **Podshelf**: pin projection responses via `node:test` in `test/`. Same pattern
  as the existing parser/projection-shape tests. Specifically:
  - `?fields=id,slug,updated_at` returns exactly those three keys per row.
  - `?fields=bogus` returns 400.
  - `?include=chapters,transcript` returns the keys when sidecars exist; omits
    them when null; populates `_warnings` on storage fetch errors.
  - People attach / person update bump `episodes.updated_at` on every affected
    episode.
- **Consumer sync scripts**: integration test that runs the sync against a
  recorded Podshelf API fixture, asserts the resulting `content/` tree. One
  fixture per scenario (no-op, one upsert, one delete, one cold start).
- **End-to-end**: dry-run the new sync against the live Podshelf instance,
  diff the output vs. today's full-sync output. Should be byte-identical apart
  from the timing-sensitive fields the sync writes (build timestamps if any).

## Open questions

- **Soft-delete propagation.** Today's sync prunes any `.md` whose slug isn't
  in the index. If we expose `?fields=…,deleted_at` and the index includes
  soft-deleted rows, consumers must filter on `!deleted_at`. Decide whether
  the index defaults to "only live" or returns everything-with-deleted_at;
  the pseudocode above assumes the latter. Probably belongs as an explicit
  `?include_deleted=true` opt-in.
- **`updated_at` granularity.** Stored as `TEXT DEFAULT (datetime('now'))` —
  second resolution. Two writes in the same second produce identical
  timestamps. Risk: a CI build that interleaves with a Podshelf write could
  read an index row with the same `updated_at` as the on-disk file but with
  different content. Probably negligible in practice (Podshelf writes are
  human-paced) but worth a comment. Mitigation if it bites: switch to
  `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` for ms resolution.
- **Per-show storage failures.** If chapters/transcript URLs live in the show's
  own S3/SFTP and that's misconfigured, `?include=` will silently log warnings
  on every build. Should the build fail loudly instead? Lean toward "warn, don't
  fail" — operator gets the signal without the deploy being held hostage to
  storage state that the consumer can't fix.

## Future work (deferred)

- **Audit-log-backed `/changes?since=<cursor>` endpoint.** The original
  conversation explored this. Filesystem-based reconciliation gets the same
  best-case cost without the cursor management, so this isn't necessary today.
  Worth revisiting only if we hit a case the index can't represent — e.g., a
  network of hundreds of shows where even the per-show 5-call cost becomes a
  bottleneck.
- **Streaming / Server-Sent Events for live preview.** Out of scope; static
  sites don't need it.
- **Shared sync library across consumers.** Today's three sync scripts are
  drifting (different filenames, different merge strategies). Once incremental
  is shipped and stable, candidate for extraction to a small npm package
  consumed by all three. Not blocking.
