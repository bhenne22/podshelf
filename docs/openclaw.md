# OpenClaw Integration

OpenClaw is the bash-based watcher that auto-ingests episode folders into
Podshelf. Drop a folder containing audio (and optionally a transcript) into a
watched directory, and it uploads the audio, optionally generates show notes
via Claude, creates a draft episode, and pings Discord.

The watcher uses Podshelf's standard API key authentication and is scoped to
a single podcast — run one watcher per podcast.

---

## Workflow

```
recording.mp3 + episode.txt
       │
       ▼
~/podcast-inbox/<episode-folder>/
       │
       ▼   (inotifywait / fswatch sees the folder)
       │
podshelf-watch.sh
   1. Upload MP3 to /api/podcasts/<slug>/upload
   2. (Optional) generate show notes from episode.txt via Claude CLI
   3. Create draft episode at /api/podcasts/<slug>/episodes
   4. Notify Discord (if webhook configured)
       │
       ▼
Review and publish in /podcasts/<slug>/episodes/<id>
```

---

## Install dependencies

System tools:

```bash
# Linux (Ubuntu/Debian)
sudo apt install -y inotify-tools curl jq

# macOS
brew install fswatch curl jq
```

Optional Claude CLI (for AI-generated show notes):

```bash
npm install -g @anthropic-ai/claude-code
claude   # follow the OAuth flow once
```

Then make the watcher executable:

```bash
chmod +x /path/to/podshelf/openclaw/podshelf-watch.sh
```

---

## Mint a Podshelf API key

In the Podshelf admin → **API Keys** → **+ New Key**:

- **Label:** `OpenClaw <podcast-slug>` (one per podcast keeps audit clean)
- **Permissions:** `write` is enough — the watcher creates episodes but
  doesn't delete anything
- **Scope:** restrict to the podcast it should publish to

Copy the plaintext key immediately; it's only shown once.

---

## Configuration

Configured via environment variables:

| Variable | Required | Description |
|---|---|---|
| `WATCH_DIR` | | Directory to watch (default `~/podcast-inbox`) |
| `PODSHELF_URL` | | Base URL of your Podshelf instance (default `http://localhost:3000`) |
| `PODSHELF_API_KEY` | yes | The API key minted above |
| `PODSHELF_PODCAST` | yes | Slug of the podcast to publish to |
| `DISCORD_WEBHOOK_URL` | | Discord webhook for notifications (default disabled) |
| `USE_CLAUDE` | | `true`/`false` — toggle Claude show-notes generation (default `true` if `claude` is on PATH) |
| `CLAUDE_PROMPT_PREFIX` | | Override the prompt template sent to Claude before the transcript |

---

## Episode folder layout

Each folder inside `$WATCH_DIR` becomes one episode. The folder name is
slugified for the URL slug and title-cased for the title.

```
~/podcast-inbox/
└── ep-042-western-states-recap/
    ├── ws-recap.mp3       # required (any .mp3 or .m4a)
    └── episode.txt        # optional transcript / notes for Claude
```

`episode.txt` can be:

- A Whisper auto-transcription (`whisper audio.mp3 --output_format txt`)
- A Descript / Otter export
- Your own bullet-point notes
- A mix

The richer the transcript, the better the generated show notes.

---

## Run

### Foreground (test run)

```bash
PODSHELF_URL=https://podshelf.hennemo.com \
PODSHELF_API_KEY=pk_… \
PODSHELF_PODCAST=yousaid100miles \
WATCH_DIR=~/podcast-inbox \
./openclaw/podshelf-watch.sh
```

### Background

```bash
PODSHELF_URL=https://podshelf.hennemo.com \
PODSHELF_API_KEY=pk_… \
PODSHELF_PODCAST=yousaid100miles \
nohup ./openclaw/podshelf-watch.sh >> ~/podshelf-watch.log 2>&1 &
echo $! > ~/podshelf-watch.pid
```

Stop with `kill $(cat ~/podshelf-watch.pid)`.

### systemd (Linux production)

```ini
# /etc/systemd/system/podshelf-watch@.service
# Templated — instance name is the podcast slug.

[Unit]
Description=Podshelf OpenClaw watcher (%i)
After=network.target

[Service]
Type=simple
User=podshelf
WorkingDirectory=/home/podshelf
EnvironmentFile=/home/podshelf/openclaw-%i.env
ExecStart=/home/podshelf/podshelf/openclaw/podshelf-watch.sh
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Per-podcast env file `/home/podshelf/openclaw-yousaid100miles.env`:

```env
WATCH_DIR=/home/podshelf/inbox/yousaid100miles
PODSHELF_URL=https://podshelf.hennemo.com
PODSHELF_API_KEY=pk_…
PODSHELF_PODCAST=yousaid100miles
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/…
```

Enable and start (one instance per podcast):

```bash
systemctl daemon-reload
systemctl enable --now podshelf-watch@yousaid100miles
journalctl -u podshelf-watch@yousaid100miles -f
```

### macOS launchd

Use a `~/Library/LaunchAgents/com.podshelf.watch.<slug>.plist` plist with
`ProgramArguments` pointing at the watcher and `EnvironmentVariables`
containing the four required vars (`PODSHELF_URL`, `PODSHELF_API_KEY`,
`PODSHELF_PODCAST`, `WATCH_DIR`).

---

## Troubleshooting

**`PODSHELF_PODCAST is required` / `PODSHELF_API_KEY is required`** — set
both in the environment.

**`Upload failed`** — almost always:
- 401: API key wrong, expired, or disabled
- 403: API key is scoped to a different podcast, or doesn't have `write`
  permission
- Other 4xx: storage isn't configured for the podcast yet (visit the
  podcast's Storage tab in the admin)

**`claude: command not found`** — install with
`npm install -g @anthropic-ai/claude-code`, or set `USE_CLAUDE=false` to skip
show-notes generation entirely.

**Folder not detected on macOS** — `brew install fswatch` and verify with
`fswatch ~/podcast-inbox` directly.

---

## Single-shot alternative: `scripts/podshelf-publish.sh`

If you don't need a long-running watcher and just want to push one episode,
the repo also ships `scripts/podshelf-publish.sh`:

```bash
PODSHELF_API_KEY=pk_… \
./scripts/podshelf-publish.sh \
  --podcast yousaid100miles \
  --file /path/to/episode.mp3 \
  --title "Ep 50: Title" \
  --description "<p>Show notes</p>"
```

Same API path, just no folder-watching loop.
