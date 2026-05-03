# Getting Started

This walkthrough takes you from a fresh clone to publishing your first episode.

---

## Prerequisites

- Node.js 20 LTS (or 18+, but 20 is what production targets)
- A C toolchain for `better-sqlite3` to compile against
  - macOS: Xcode Command Line Tools (`xcode-select --install`)
  - Ubuntu/Debian: `sudo apt install build-essential python3`
- For uploads (optional during local dev): SFTP access to a host with a
  web-accessible directory, OR S3-compatible storage credentials. You can
  develop without these — just paste pre-existing audio URLs into episodes.

---

## Install

```bash
git clone https://github.com/bhenne22/podshelf.git
cd podshelf
npm install
```

---

## Configure

Create `.env` at the repo root with two random keys and your local site URL:

```bash
cat > .env <<EOF
DATABASE_PATH=./data/podshelf.db
NUXT_SECRET_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
PODSHELF_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
SITE_URL=http://localhost:3000
EOF
```

Each key should be 32 bytes (64 hex chars). The `NUXT_SECRET_KEY` signs your
session cookie; the `PODSHELF_ENCRYPTION_KEY` encrypts SFTP/S3/PAT credentials
that live in the database. Lose either and you'll need to reset what depends
on it (sessions invalidate / saved storage configs become unreadable).

---

## Bootstrap the first admin user

Podshelf has no built-in admin password — every login is a real user account.
Run the bootstrap script:

```bash
npm run create-admin
```

Enter an email and a password (≥ 8 chars). The user is created with
`is_admin = 1`. You can re-run this script later to reset the password.

---

## Run

```bash
npm run dev
```

Open `http://localhost:3000`. You'll be redirected to `/login`. Sign in
with the user you just created.

---

## First podcast → first episode

1. From the empty Podcasts list, click **+ New Podcast**. Title auto-fills the
   slug; everything else can stay blank for now.
2. You'll land on the podcast's **Settings** tab. Fill in author, email,
   image URL, website. Save.
3. Click **Storage** in the per-podcast nav. Pick SFTP or S3, fill in the
   form (paste the SFTP private key contents directly into the textarea — see
   [storage.md](./storage.md) for details). Hit **Test Connection** to verify
   credentials and that you pointed at the right remote dir. Save.
4. Click **Episodes** → **+ New Episode**. Either upload a file or paste a
   pre-existing audio URL. Click **Check File** to detect size/duration.
   **Save & Publish**.
5. Visit `http://localhost:3000/feeds/<your-podcast-slug>.xml` to see the
   resulting RSS feed.

---

## Migrating an existing show

If you're moving from another podcast host onto Podshelf, the **+ New Episode**
flow has a sibling button on the empty episodes list: **Import from existing
RSS feed**. Paste your old feed URL and Podshelf imports every episode at
once with their original audio URLs intact. Available only while the podcast
is empty (no destructive overwrite).

---

## API and automation

Mint an API key at `/api-keys`:
- Label it (e.g. "Claude", "OpenClaw", "dev-laptop")
- Optionally set an expiration
- Pick a permission level (read / write / full)
- Optionally restrict to specific podcasts

The plaintext key is shown exactly once — copy it immediately.

Use it in either header:

```bash
curl -H "X-Api-Key: pk_…" http://localhost:3000/api/podcasts
# or
curl -H "Authorization: Bearer pk_…" http://localhost:3000/api/podcasts
```

The full API surface and an end-to-end "AI handoff" example are in
[api.md](./api.md). For a bash wrapper that uploads + creates an episode in
one command, see `scripts/podshelf-publish.sh` at the repo root.

---

## Going to production

See [deployment.md](./deployment.md) for the full Linux/nginx runbook used to
stand up `podshelf.hennemo.com`.
