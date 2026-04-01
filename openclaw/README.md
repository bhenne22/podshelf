# OpenClaw — Automated Episode Ingestion

OpenClaw is the name for Podshelf's folder-watcher integration. Drop an episode folder into a directory, and OpenClaw picks it up, uploads the audio, optionally writes show notes with Claude AI, and creates a draft episode in your Podshelf — all automatically.

---

## What It Does

1. **Watches** a directory (`~/podcast-inbox` by default) for new subdirectories.
2. **Uploads** the audio file (`.mp3` or `.m4a`) to your configured storage adapter (SFTP or S3).
3. **Generates show notes** from an `episode.txt` transcript file using the Claude CLI (`claude -p`).
4. **Creates a draft episode** in Podshelf via the API — ready for your review before publishing.
5. **Notifies** via Discord webhook (optional).

---

## Prerequisites

### System Dependencies

**Linux:**
```bash
sudo apt install inotify-tools curl jq
```

**macOS:**
```bash
brew install fswatch curl jq
```

### Optional: Claude CLI (for AI show notes)
```bash
npm install -g @anthropic-ai/claude-code
# Then authenticate:
claude
```

---

## Episode Folder Structure

Create a subdirectory inside your watch folder. The folder name becomes the episode title (hyphens/underscores → spaces, title-cased).

```
~/podcast-inbox/
  my-epic-ultramarathon-recap/
    audio.mp3          ← required (.mp3 or .m4a)
    episode.txt        ← optional transcript / notes for Claude
```

Example folder names and the titles they produce:
- `my-epic-ultramarathon-recap` → "My Epic Ultramarathon Recap"
- `ep-42-gear-review` → "Ep 42 Gear Review"
- `2025-01-15_long_run_debrief` → "2025 01 15 Long Run Debrief"

### episode.txt

This can be:
- A rough transcript (auto-generated from Whisper, Descript, etc.)
- Your own show notes / bullet points
- A combination

Claude will turn it into polished HTML show notes. If no `episode.txt` is present, the description will be left as the episode title.

---

## Setup

### 1. Configure environment variables

Copy the example config and edit it:

```bash
cp .env.example .env
# Edit .env with your Podshelf URL and password
```

Key variables for OpenClaw:

| Variable | Description | Default |
|---|---|---|
| `WATCH_DIR` | Folder to watch for new episodes | `~/podcast-inbox` |
| `PODSHELF_URL` | Your Podshelf instance URL | `http://localhost:3000` |
| `PODSHELF_ADMIN_PASSWORD` | Admin password (matches `ADMIN_PASSWORD` in Podshelf .env) | empty |
| `DISCORD_WEBHOOK_URL` | Discord webhook for notifications | empty |
| `USE_CLAUDE` | Set `false` to skip Claude show notes | `true` |
| `CLAUDE_PROMPT_PREFIX` | Override the prompt sent to Claude | (see script) |

### 2. Make the script executable

```bash
chmod +x openclaw/podshelf-watch.sh
```

### 3. Run the watcher

**Foreground (testing):**
```bash
WATCH_DIR=~/podcast-inbox \
PODSHELF_URL=https://mypodcast.example.com \
PODSHELF_ADMIN_PASSWORD=mysecretpassword \
./openclaw/podshelf-watch.sh
```

**Background with logging:**
```bash
WATCH_DIR=~/podcast-inbox \
PODSHELF_URL=https://mypodcast.example.com \
PODSHELF_ADMIN_PASSWORD=mysecretpassword \
nohup ./openclaw/podshelf-watch.sh >> ~/podshelf-watch.log 2>&1 &
```

**As a systemd service (Linux):**

Create `/etc/systemd/system/podshelf-watch.service`:

```ini
[Unit]
Description=Podshelf OpenClaw Watcher
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/home/youruser/podshelf
EnvironmentFile=/home/youruser/podshelf/.env
Environment="WATCH_DIR=/home/youruser/podcast-inbox"
Environment="PODSHELF_URL=http://localhost:3000"
ExecStart=/home/youruser/podshelf/openclaw/podshelf-watch.sh
Restart=on-failure
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable podshelf-watch
sudo systemctl start podshelf-watch
sudo journalctl -u podshelf-watch -f
```

---

## What Happens After Processing

- The episode folder is renamed to `<folder-name>.processed` to avoid re-processing on restart.
- A **draft** episode is created in Podshelf. Log into `/admin/episodes` to review, add episode numbers, and publish.
- If Discord notifications are configured, you'll get a message with a direct link to the admin edit page.

---

## Tips

### Using Whisper for Transcription

[OpenAI Whisper](https://github.com/openai/whisper) can auto-transcribe your audio before dropping it in the inbox:

```bash
whisper audio.mp3 --output_format txt --output_dir ./my-episode/
mv my-episode/audio.txt my-episode/episode.txt
mv my-episode ~/podcast-inbox/
```

### Batch Processing

All unprocessed folders in the watch directory are processed on script startup. You can pre-populate the inbox and then start the watcher:

```bash
cp -r episode-001 ~/podcast-inbox/
cp -r episode-002 ~/podcast-inbox/
./openclaw/podshelf-watch.sh  # processes both, then watches for new ones
```

### Custom Claude Prompts

Override `CLAUDE_PROMPT_PREFIX` to customize how show notes are generated:

```bash
export CLAUDE_PROMPT_PREFIX="You are a show notes writer for an ultrarunning podcast. Write HTML show notes with sections: Overview, Key Moments (with timestamps), Gear Mentioned, and Links. Transcript:"
```
