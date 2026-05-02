# OpenClaw — Automated Episode Ingestion

OpenClaw is Podshelf's folder-watcher. Drop an episode folder into a watched
directory and it uploads the audio, optionally generates show notes via the
Claude CLI, and creates a draft episode through Podshelf's API.

This README is the quick reference for the script in this directory. The
**full integration guide** is at [`../docs/openclaw.md`](../docs/openclaw.md).

---

## tl;dr

```bash
# 1. Mint an API key in the Podshelf admin (/admin/api-keys), scoped to one
#    podcast, with `write` permissions.

# 2. Install deps:
sudo apt install -y inotify-tools curl jq        # Linux
# brew install fswatch curl jq                   # macOS

# 3. Run the watcher:
PODSHELF_URL=https://podshelf.example.com \
PODSHELF_API_KEY=pk_xxxxxxxxxxxx \
PODSHELF_PODCAST=your-podcast-slug \
WATCH_DIR=~/podcast-inbox \
./podshelf-watch.sh
```

Drop `~/podcast-inbox/<episode-folder>/` (containing one `.mp3` or `.m4a`,
and optionally an `episode.txt` transcript) and the watcher does the rest.

---

## Required env vars

| Var | Purpose |
|---|---|
| `PODSHELF_URL` | Base URL of your Podshelf instance |
| `PODSHELF_API_KEY` | API key minted in the admin (write-permission, scoped to the podcast) |
| `PODSHELF_PODCAST` | Slug of the target podcast |

Optional: `WATCH_DIR`, `DISCORD_WEBHOOK_URL`, `USE_CLAUDE`,
`CLAUDE_PROMPT_PREFIX`. See `../docs/openclaw.md` for full descriptions and
systemd / launchd setup.

---

## What ends up where

After processing:
- Audio file lives at the URL returned by the upload endpoint (whatever
  storage you configured for the podcast)
- A new **draft** episode at `<PODSHELF_URL>/admin/<PODSHELF_PODCAST>/episodes/<id>`
  with the title, audio URL, file size, and (if Claude ran) HTML show notes
  prefilled

Review in the admin, set the episode number / season, click **Save & Publish**.
