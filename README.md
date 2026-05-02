# Podshelf

**Multi-tenant, headless podcast publishing.**

Podshelf is a small self-hosted tool that owns your show metadata and your RSS
feed. It's designed to live behind your real podcast website, not replace it —
you publish episodes here, Podshelf serves the feed and (optionally) kicks
your static site to redeploy on every change.

---

## What it is

- A **Nuxt 3 / Nitro** server with a SQLite database (no external services)
- A **multi-user admin UI** — multiple users, multiple podcasts, with per-user
  API keys for automation
- A **valid RSS 2.0 + iTunes feed** at `/feeds/<podcast-slug>.xml`
- A **per-podcast storage layer** — each podcast configures its own SFTP or
  S3-compatible target, with credentials encrypted at rest in the database
- A **GitHub `repository_dispatch` trigger** so publishing an episode can
  automatically rebuild your static podcast site
- An **RSS importer** for migrating an existing show onto Podshelf
- Built-in **download tracking** with optional GeoIP lookup

There is no public-facing listener site here — Podshelf serves the admin and
the feed only. Listener pages live wherever you serve your static podcast
site (or whatever your audience hits).

---

## Architecture

```
podshelf/
├── server/
│   ├── db/        SQLite (better-sqlite3, sync) + lightweight migration runner
│   ├── api/       Nitro API: /api/podcasts/[slug]/..., /api/me/api-keys, /api/users
│   ├── routes/    /feeds/[slug].xml, /track/[...path] (download redirect)
│   ├── storage/   SFTP and S3 adapters (take config args, no env-coupling)
│   └── utils/     auth, password, crypto (AES-256-GCM), github, rss-parser
├── pages/admin/   Admin UI: podcast list, per-podcast tabs, API keys, users
├── components/    AdminNav, RichTextEditor (TipTap)
├── composables/   useEpisodes(slug), useUpload(slug)
├── middleware/    admin-auth (verifies session via /api/me)
├── scripts/       create-admin.ts, podshelf-publish.sh
└── openclaw/      Bash watcher that auto-ingests episode folders via the API
```

**Auth:** email + password login → HMAC-signed session cookie. API keys (per
user) accept `X-Api-Key` or `Authorization: Bearer`. Keys can be scoped to
specific podcasts and limited to read / write / full permission levels.

**Storage:** each podcast row carries its own AES-256-GCM-encrypted blob with
SFTP or S3 credentials. The `PODSHELF_ENCRYPTION_KEY` env var is the only
secret outside the DB.

**RSS feed:** rendered live from the DB on each request. Optional
`audio_tracking_prefix` per podcast lets you front audio URLs with Podshelf's
`/track/` redirect (IAB-deduped, GeoIP-stamped) or a third-party tracker like
Blubrry/Chartable.

**Build trigger:** when an episode publishes (or a feed-visible podcast
setting changes), Podshelf can fire a `repository_dispatch` event at a
configured GitHub repo. Your static-site workflow listens for it and
redeploys.

---

## Quick start (development)

```bash
git clone https://github.com/bhenne22/podshelf.git
cd podshelf
npm install

# Generate keys for .env
cat > .env <<EOF
DATABASE_PATH=./data/podshelf.db
NUXT_SECRET_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
PODSHELF_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
SITE_URL=http://localhost:3000
EOF

# Create the first admin user
npm run create-admin

# Run dev server
npm run dev
```

Then open http://localhost:3000 and sign in.

For full production setup see [docs/deployment.md](./docs/deployment.md).

---

## Documentation

- **[Getting Started](./docs/getting-started.md)** — local dev setup, first podcast, first episode
- **[Storage](./docs/storage.md)** — configuring per-podcast SFTP or S3 in the admin UI
- **[Deployment](./docs/deployment.md)** — production install on a Linux box (Ubuntu/Debian) behind nginx
- **[API](./docs/api.md)** — full API surface, with an "AI handoff" section for automation
- **[OpenClaw](./docs/openclaw.md)** — bash watcher that drops episode folders into Podshelf via the API

---

## Environment variables

Only four matter at the env layer (everything else moved into the admin UI):

| Variable | Purpose |
|---|---|
| `DATABASE_PATH` | SQLite file path (default: `./data/podshelf.db`) |
| `NUXT_SECRET_KEY` | Used to sign session tokens. Required. 32-byte hex. |
| `PODSHELF_ENCRYPTION_KEY` | Used to encrypt SFTP/S3/PAT credentials in the DB. Required when configuring storage. 32-byte hex. |
| `SITE_URL` | Public URL of this Podshelf instance, used by the track-redirect prefix and feed metadata. |
| `GEOIP_DB_PATH` | Optional. Path to a MaxMind GeoLite2-City `.mmdb` for download geolocation. |

---

## License

MIT — do whatever you want with it.
