# Podshelf

**Your podcast. Your server. No middleman.**

Podshelf is an open-source, self-hosted podcast publishing platform for hobbyists. Upload your audio to your own SFTP server or S3 bucket, manage episodes through a clean admin interface, and serve a valid RSS feed that works with every podcast app. No monthly subscription. No algorithm. No one else's rules.

---

## Origin Story

Podshelf was born from the frustration of automating the publishing workflow for *[You Said 100 Miles?](https://example.com)*, an ultrarunning podcast. Every episode required the same tedious steps: upload MP3 to hosting, log into a platform, fill in metadata, wait for publishing. After building a bash script to automate parts of it, then another script, and then another — it became clear the right answer was a small, purpose-built tool that a hobbyist could self-host and actually understand.

Podshelf is what that tool became.

---

## What It Is

- A **Nuxt 3** web app that runs on any Node.js server
- A **SQLite database** (via better-sqlite3) — no external database required
- A **clean admin UI** for managing episodes and show settings
- A **valid RSS 2.0 feed** with full iTunes namespace support
- A **storage layer** that uploads audio to SFTP or S3-compatible storage
- An **OpenClaw integration** — a bash watcher that auto-ingests episode folders, generates show notes with Claude AI, and creates draft episodes

---

## Features

- **Episode management** — Create, edit, publish, unpublish episodes. Draft workflow.
- **RSS 2.0 feed** — Full iTunes/Apple Podcasts namespace. Compatible with every major podcast app.
- **SFTP upload** — Upload audio directly to your shared hosting via SSH key auth.
- **S3 upload** — Works with AWS S3, Backblaze B2, Cloudflare R2, and any S3-compatible provider.
- **Admin password protection** — Simple cookie-based auth. No accounts needed.
- **Public podcast site** — Clean, mobile-friendly public-facing site with audio player.
- **OpenClaw automation** — Drop an episode folder, get a draft episode. AI show notes via Claude CLI.
- **No framework lock-in** — Plain HTML/CSS in Vue components. No Tailwind, no Bootstrap, no dependencies beyond Nuxt.
- **SQLite embedded** — Single binary database. Backs up with `cp`. No running database process.

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/your-repo/podshelf.git
cd podshelf

# 2. Install dependencies
npm install

# 3. Configure
cp .env.example .env
# Edit .env: set SITE_URL, STORAGE_ADAPTER, storage credentials, ADMIN_PASSWORD

# 4. Develop
npm run dev

# 5. Open admin
open http://localhost:3000/admin
```

For production:
```bash
npm run build
node .output/server/index.mjs
```

---

## Architecture

```
podshelf/
├── server/
│   ├── db/           SQLite database (better-sqlite3, sync)
│   ├── api/          REST API endpoints (Nitro/h3)
│   ├── routes/       feed.xml — RSS feed generator
│   └── storage/      SFTP and S3 upload adapters
├── pages/
│   ├── index.vue     Public podcast homepage
│   ├── episodes/     Public episode pages
│   └── admin/        Admin interface (episodes, settings)
├── components/       AudioPlayer, EpisodeCard, AdminNav
├── composables/      useEpisodes — API wrapper
├── middleware/       admin-auth — cookie-based admin protection
└── openclaw/         Folder watcher + Claude AI integration
```

**Server:** Nuxt 3 with Nitro server engine. All API routes are in `server/api/` using `defineEventHandler` from h3. The RSS feed is a Nitro route in `server/routes/`.

**Database:** SQLite via `better-sqlite3` (synchronous API — no async/await needed for DB calls). Auto-migrated on startup from `server/db/schema.sql`.

**Storage:** At upload time, Podshelf reads `STORAGE_ADAPTER` from env and delegates to either `server/storage/sftp.ts` or `server/storage/s3.ts`. The returned public URL is stored in the episode record.

**Frontend:** Vue 3 components with scoped CSS. No UI framework — just clean, hand-written styles.

---

## Documentation

- [Getting Started](./docs/getting-started.md) — Setup guide, Dreamhost tips, first episode walkthrough
- [Storage Configuration](./docs/storage.md) — SFTP vs S3, provider-specific setup instructions
- [OpenClaw Integration](./docs/openclaw.md) — Automated episode ingestion with Claude AI

---

## Environment Variables

See [`.env.example`](./.env.example) for the full list. Key variables:

| Variable | Description |
|---|---|
| `DATABASE_PATH` | SQLite database file path |
| `SITE_URL` | Public URL of your podcast site |
| `ADMIN_PASSWORD` | Password for `/admin` area |
| `STORAGE_ADAPTER` | `sftp` or `s3` |
| `SFTP_*` | SFTP connection settings |
| `S3_*` | S3/Backblaze B2 settings |

---

## Contributing

Podshelf is intentionally small. Contributions that keep it simple and hobbyist-friendly are welcome:

1. Fork the repo
2. Create a branch: `git checkout -b my-feature`
3. Commit your changes
4. Open a pull request

Please keep the spirit: no bloat, no SaaS features, no "growth" nonsense.

---

## License

MIT — do whatever you want with it. If you build something cool, tell me about it.

---

*Built for people who just want to publish a podcast without giving away their audience, their content, or their money.*
