# Network architecture

This document describes how Podshelf fits into the four-repo network that publishes
the Team Puma Knife podcast family. The canonical version of this doc lives at
[`teampumaknife.com/docs/architecture.md`](../../teampumaknife.com/docs/architecture.md);
this copy is here so anyone landing in the Podshelf repo can get the full picture
without leaving the directory.

## At a glance

- **Podshelf (this repo)** is the source of truth — a self-hosted multi-tenant
  podcast CMS that owns episode metadata, RSS feeds, distribution config,
  transcripts, and chapters.
- **Three Nuxt 3 static sites** consume Podshelf's API + feed XML at build time and
  publish to DreamHost shared hosting:
  - `teampumaknife.com` — network hub, builds a page for every show.
  - `yousaid100miles.com` — dedicated site for the *You Said 100 Miles?* show.
  - `yourewatchingitwrong.com` — dedicated site for the *You're Watching It Wrong* show.
- **Audio files live on DreamHost**, not Podshelf. The static sites mirror the RSS
  feed so podcast apps fetch from DreamHost too. Podshelf itself stays cold to
  listener traffic — it only sees admin requests and per-deploy API hits.
- **Publishes propagate via GitHub `repository_dispatch` events.** Podshelf fires one
  on episode publish; dedicated child sites forward a second event to TPK after their
  own deploy so the hub picks up the new metadata.

## The repos

| Repo | Role | Stack | Hosting |
|---|---|---|---|
| [podshelf](../CLAUDE.md) | Source of truth: CMS, API, RSS feeds, storage adapters | Nuxt 3 full-stack + SQLite (`better-sqlite3`) | Linode VPS (1 GB Ubuntu) behind nginx + Cloudflare |
| [teampumaknife.com](../../teampumaknife.com/CLAUDE.md) | Network hub: a page per show, mirrored feeds, "from the vault" | Nuxt 3 static (SSG) + `@nuxt/content` + Tailwind v4 | DreamHost shared (`teampumaknife.com`) |
| [yousaid100miles.com](../../yousaid100miles.com/CLAUDE.md) | Dedicated site for *You Said 100 Miles?* (slug `ys100m`) | Nuxt 3 static + `@nuxt/content` + Tailwind v4 | DreamHost shared (`yousaid100miles.com`) |
| [yourewatchingitwrong.com](../../yourewatchingitwrong.com/CLAUDE.md) | Dedicated site for *You're Watching It Wrong* (slug `ywiw`) | Nuxt 3 static + `@nuxt/content` + Tailwind v4 | DreamHost shared (`yourewatchingitwrong.com`) |

Shows in the network that don't have their own dedicated site are served entirely
from TPK — their `/shows/<slug>/` and `/shows/<slug>/<episode>` pages on TPK *are*
the listener experience.

## This repo's role

**Podshelf is the source of truth and the only stateful service in the network.**
Everything else is a static-site build that re-derives its content from Podshelf's
API on every deploy.

What Podshelf owns:

- **The database.** SQLite (`server/db/schema.sql`) holds every podcast, episode,
  person, distribution destination, audit log entry, and slug alias. The static
  sites have no database of their own.
- **The RSS feed.** `server/routes/feeds/[slug].xml.ts` renders the canonical feed
  for each podcast at `GET /feeds/[slug].xml`. The static sites mirror this XML
  byte-for-byte and serve it from DreamHost under their own URLs — listener apps
  subscribe to the mirror, not to Podshelf.
- **The audio storage adapter.** `server/storage/sftp.ts` (and `s3.ts`) upload
  episode audio + artwork to wherever each podcast's storage is configured. For
  this network that's DreamHost SFTP under the relevant show's subdomain. Podshelf
  is *not* in the audio download path — it just writes the file once and emits the
  public URL.
- **The publish fan-out.** `server/utils/publish-event.ts → firePublishEvent()` is
  the single point where "an episode just became live" triggers
  `bumpFeedLastModified()`, `maybeAutoTrigger()` (the GitHub dispatch path), and
  `sendPublishWebhook()`.

What lives outside Podshelf: episode pages, listener-facing UI, transcript players,
network-level branding. None of those land in this repo.

The GitHub dispatch path is configured per-podcast under `/podcasts/<slug>/github`.
For shows with a dedicated site, dispatch the *site's* repo (which then forwards to
TPK after its deploy). For shows without a dedicated site, dispatch TPK directly
with event type `podshelf-feed-update`.

## Diagram

```mermaid
flowchart TB
    Listener((Podcast apps /<br/>listeners))

    subgraph Linode["Linode VPS (podshelf.hennemo.com)"]
        PS[Podshelf<br/>Nuxt 3 + SQLite<br/>multi-tenant CMS]
    end

    subgraph GH["GitHub Actions"]
        WF_YS[ys100m<br/>deploy.yml]
        WF_YW[ywiw<br/>deploy.yml]
        WF_TPK[teampumaknife<br/>deploy.yml]
    end

    subgraph DH["DreamHost shared hosting"]
        YS[yousaid100miles.com<br/>static site + mirrored feed]
        YW[yourewatchingitwrong.com<br/>static site + mirrored feed]
        TPK[teampumaknife.com<br/>hub + per-show feeds + hosted-show pages]
        AUDIO[(Audio + artwork<br/>per-show subdomains)]
    end

    %% Build-time data
    PS -- "JSON API + feed XML" --> WF_YS
    PS -- "JSON API + feed XML" --> WF_YW
    PS -- "JSON API + feed XML<br/>(all shows)" --> WF_TPK

    %% Dispatch chain
    PS -. "repository_dispatch<br/>podshelf-feed-update" .-> WF_YS
    PS -. "repository_dispatch<br/>podshelf-feed-update" .-> WF_YW
    PS -. "repository_dispatch<br/>podshelf-feed-update<br/>(shows w/o dedicated site)" .-> WF_TPK
    WF_YS -. "repository_dispatch<br/>child-site-updated" .-> WF_TPK
    WF_YW -. "repository_dispatch<br/>child-site-updated" .-> WF_TPK

    %% Deploys
    WF_YS -- "SFTP" --> YS
    WF_YW -- "SFTP" --> YW
    WF_TPK -- "lftp mirror" --> TPK

    %% Audio storage (Podshelf writes via SFTP storage adapter)
    PS -- "SFTP upload<br/>(storage adapter)" --> AUDIO

    %% Listener traffic — note Podshelf is NOT in this path
    Listener -- "RSS" --> YS
    Listener -- "RSS" --> YW
    Listener -- "RSS" --> TPK
    Listener -- "MP3" --> AUDIO
```

Solid arrows are continuous data flows (HTTP fetches, file uploads, listener
traffic). Dashed arrows are event-driven `repository_dispatch` hops.

## Data flow at build time

Each downstream Nuxt site runs a sync script before `nuxt generate` that pulls from
Podshelf's API + feed XML:

| What | Source on Podshelf | Where it lands on the consumer |
|---|---|---|
| Show metadata | `GET /api/podcasts/[slug]` | `content/shows/*.md` (TPK) or `assets/podcast.json` (sister sites) |
| Episodes | `GET /api/podcasts/[slug]/episodes` | `content/episodes/<slug>.md` |
| Distribution ("Listen on") | `GET /api/podcasts/[slug]/distribution` | Markdown frontmatter (TPK) / `assets/distribution.json` (sister sites) |
| RSS feed | `GET /feeds/[slug].xml` | `public/feed/<feedSlug>/index.xml` (TPK) or `public/feed.xml` (sister sites) |
| Transcripts | Per-episode `transcript_path` (SRT/VTT) | `public/transcripts/<slug>.json` |
| Chapters | Per-episode `chapters_url` (Podcasting 2.0 JSON) | Parsed into episode frontmatter |

Most reads use an API key (`X-Api-Key` header) scoped to the appropriate podcast
slug. TPK's key is unscoped or scoped to all shows; each sister site's key is
scoped to its own slug.

## The dispatch chain — how publishes propagate

`firePublishEvent()` in `server/utils/publish-event.ts` is the single fan-out point:

1. **Feed cache bump.** Forces revalidation on cached feed responses.
2. **`maybeAutoTrigger(podcastId, source)`** — marks the podcast dirty. The
   in-process scheduler (`server/utils/github.ts`, `PUBLISH_DEBOUNCE_MINUTES = 15`)
   debounces and then calls `dispatchRepositoryEvent()`. The dispatch posts to
   `https://api.github.com/repos/<owner>/<repo>/dispatches` with
   `event_type` and `client_payload: { slug, reason, podcast_id, fired_at }`. The
   debounce coalesces a flurry of edits into one build; the per-podcast kill switch
   on `/podcasts/<slug>/build` blocks all paths (auto, manual, test).
3. **`sendPublishWebhook()`** — optional Discord / Slack / generic JSON post.

The configured repo is **whichever site owns the show's listener experience**:

- For shows with a dedicated site, dispatch the dedicated site's repo (event type
  `podshelf-feed-update`). The site rebuilds, then its `deploy.yml` fires a second
  `child-site-updated` dispatch to TPK so the hub re-pulls and re-renders.
- For shows without a dedicated site, dispatch TPK directly. The hub is the
  listener experience, so no second hop is needed.

Both downstream workflows are idempotent — a duplicate fire just rebuilds and
re-uploads what was already there. The selective-sync enhancement (see TPK
`docs/enhancements.md`) plans to use `client_payload.slug` to only sync the
affected show, cutting ~87% of build-time API calls.

## Hosting layout

| Property | Box | Why |
|---|---|---|
| Podshelf (this repo) | Linode VPS (1 GB Ubuntu, nginx + Cloudflare) | Keeps the CMS off shared hosting so we can run Node + SQLite. Listener traffic never lands here, so the small box is enough. |
| Static sites | DreamHost shared, one subscription, three subdomains | DreamHost shared is PHP-only at runtime, but for static SSG output that doesn't matter — it just serves files. "Unlimited" bandwidth on shared makes it the right home for podcast traffic. |
| Audio + artwork | DreamHost shared, under each show's subdomain | Listener MP3 fetches dominate bandwidth. Keeping them on DreamHost (not Podshelf) is how the Linode stays small. Podshelf's per-podcast SFTP storage adapter writes here using credentials configured under `/podcasts/<slug>/storage`. |

Audio URLs look like `https://<show>.teampumaknife.com/podcastepisodes/<file>.mp3`.
The Linode's ingress / egress allowance would be exhausted quickly if listener
traffic passed through it; the storage-adapter split is what keeps the monthly
hosting cost predictable.

## Contracts that must not break

- **Feed URLs.** Podshelf renders the feed at `/feeds/<slug>.xml`, but listeners
  subscribe to the mirror on the static sites. If a podcast's slug ever has to
  change, write a `slug_aliases` row so the old feed URL keeps resolving and the
  feed handler emits `<itunes:new-feed-url>` per spec.
- **Audio enclosure URLs.** These are permanent contracts with podcast apps. The
  feed parser on the static sites must use the `<enclosure url>` value, not the
  API's `ep.audio_url` (which is a Blubrry tracking redirect — fine for analytics,
  but some browsers stall on the 302 in `<audio>` elements).
- **The publish fan-out shape.** `firePublishEvent()` is the single point where new
  episodes side-effect into the world. New side effects belong there, not scattered
  across endpoints. Same for new `client_payload` keys — add them consistently.
- **Storage adapter contracts.** `audio` and `artwork` directories per podcast are
  distinct on purpose (different `publicUrlBase`); helpers in
  `server/utils/storage-config.ts` route by `kind`. Don't collapse them.

## Where to look next

- This repo's `CLAUDE.md` — Podshelf internals: schema, API surface, storage
  adapters.
- `docs/api.md` — full API reference (also served at `/docs` on a running instance).
- `docs/deployment.md` — Linode provisioning runbook.
- `docs/storage.md` — SFTP / S3 storage adapter setup per podcast.
- `~/Code/teampumaknife.com/CLAUDE.md` — hub-specific design, SSG gotchas, deploy
  workflow.
- `~/Code/yousaid100miles.com/CLAUDE.md`, `~/Code/yourewatchingitwrong.com/CLAUDE.md`
  — per-show site internals.
