# OpenClaw Integration

OpenClaw is Podshelf's automated episode ingestion system. Name inspired by the combination of open-source tooling and AI-powered content generation — clawing episodes out of raw files and into a polished podcast feed.

---

## Overview

The OpenClaw workflow looks like this:

```
Recording Session
      ↓
Export MP3 + rough transcript
      ↓
Drop folder into ~/podcast-inbox/
      ↓
  podshelf-watch.sh detects it
      ↓
  ┌───────────────────────────┐
  │  1. Upload MP3 to storage │
  │  2. Claude writes notes   │
  │  3. Create draft episode  │
  │  4. Notify Discord        │
  └───────────────────────────┘
      ↓
Review & publish from /admin
```

---

## Installation

### 1. Install System Dependencies

**Linux (Ubuntu/Debian):**
```bash
sudo apt update && sudo apt install -y inotify-tools curl jq
```

**macOS:**
```bash
brew install fswatch curl jq
```

### 2. Install Claude CLI (Optional but Recommended)

The Claude CLI is used to generate show notes from transcripts automatically.

```bash
npm install -g @anthropic-ai/claude-code
```

Authenticate:
```bash
claude
# Follow the OAuth flow
```

Test it works:
```bash
echo "test" | claude -p "Say hello"
```

### 3. Make the Watch Script Executable

```bash
chmod +x /path/to/podshelf/openclaw/podshelf-watch.sh
```

---

## Configuration

All configuration is done via environment variables. You can set them in your shell, a `.env` file sourced by your shell profile, or in a systemd service file.

| Variable | Description | Default |
|---|---|---|
| `WATCH_DIR` | Directory to watch for episode folders | `~/podcast-inbox` |
| `PODSHELF_URL` | Base URL of your Podshelf instance | `http://localhost:3000` |
| `PODSHELF_ADMIN_PASSWORD` | Matches `ADMIN_PASSWORD` in Podshelf `.env` | (empty) |
| `DISCORD_WEBHOOK_URL` | Discord webhook URL for notifications | (empty, disabled) |
| `USE_CLAUDE` | `true`/`false` — enable Claude show notes generation | `true` |
| `CLAUDE_PROMPT_PREFIX` | The prompt sent to Claude before the transcript | (see below) |

### Default Claude Prompt

```
Generate engaging podcast show notes in HTML format (use <p>, <ul>, <li>, <a> tags).
Include a brief summary, key topics covered, and any notable quotes or timestamps
mentioned. Keep it under 600 words. Transcript:
```

Override it completely or extend it:
```bash
export CLAUDE_PROMPT_PREFIX="You are a show notes writer for an ultrarunning podcast.
Write HTML show notes with these sections:
- <h3>Episode Summary</h3>
- <h3>Key Moments</h3> (with timestamps from the transcript if available)
- <h3>Gear & Products Mentioned</h3>
- <h3>People & Races Mentioned</h3>
Keep it under 800 words. Transcript:"
```

---

## Episode Folder Format

Each episode is a folder inside `$WATCH_DIR`. The folder name becomes the episode title.

```
~/podcast-inbox/
├── episode-001-introduction/
│   ├── intro.mp3
│   └── episode.txt
├── ep-042-western-states-recap/
│   ├── ws-recap-final.mp3
│   └── episode.txt
└── gear-review-altra-lone-peak/
    └── gear-review.mp3
```

### Folder Naming Tips

The folder name is slugified for the episode URL and title-cased for the episode title:

| Folder name | Slug | Title |
|---|---|---|
| `ep-042-western-states-recap` | `ep-042-western-states-recap` | "Ep 042 Western States Recap" |
| `2025_01_15_long_run` | `2025-01-15-long-run` | "2025 01 15 Long Run" |
| `GearReview_AltraLonePeak` | `gearreview-altralонepeak` | varies |

**Recommendation:** Use lowercase with hyphens: `ep-042-western-states-recap`

### Audio File

- Any `.mp3` or `.m4a` file in the root of the episode folder
- If multiple audio files exist, the first one found is used
- File can be named anything — the name matters less than the folder name

### episode.txt

Optional transcript file. If present, its contents are sent to Claude to generate show notes.

**Sources for episode.txt:**
- **Whisper** (local AI transcription): `whisper audio.mp3 --output_format txt`
- **Descript** (export as plain text)
- **Otter.ai** (export as plain text)
- **Your own notes** (bullet points, timestamps, etc.)
- **A mix**: Start with auto-transcription, then add corrections and notes

The quality of your `episode.txt` directly influences the quality of the generated show notes. More detail = better output.

---

## Running the Watcher

### Foreground (Development/Testing)

```bash
WATCH_DIR=~/podcast-inbox \
PODSHELF_URL=http://localhost:3000 \
PODSHELF_ADMIN_PASSWORD=yourpassword \
./openclaw/podshelf-watch.sh
```

### Background with nohup

```bash
WATCH_DIR=~/podcast-inbox \
PODSHELF_URL=https://mypodcast.example.com \
PODSHELF_ADMIN_PASSWORD=yourpassword \
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/... \
nohup ./openclaw/podshelf-watch.sh >> ~/podshelf-watch.log 2>&1 &

echo $! > ~/podshelf-watch.pid
```

Stop it:
```bash
kill $(cat ~/podshelf-watch.pid)
```

### As a systemd Service (Linux, Recommended for Production)

Create `/etc/systemd/system/podshelf-watch.service`:

```ini
[Unit]
Description=Podshelf OpenClaw Episode Watcher
After=network.target podshelf.service

[Service]
Type=simple
User=podshelf
WorkingDirectory=/home/podshelf/podshelf
Environment="WATCH_DIR=/home/podshelf/podcast-inbox"
Environment="PODSHELF_URL=http://localhost:3000"
Environment="PODSHELF_ADMIN_PASSWORD=yourpassword"
Environment="DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/..."
Environment="USE_CLAUDE=true"
ExecStart=/home/podshelf/podshelf/openclaw/podshelf-watch.sh
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable podshelf-watch
sudo systemctl start podshelf-watch

# View logs
sudo journalctl -u podshelf-watch -f
```

### macOS launchd (Recommended for macOS)

Create `~/Library/LaunchAgents/com.podshelf.watch.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.podshelf.watch</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/youruser/podshelf/openclaw/podshelf-watch.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>WATCH_DIR</key>
    <string>/Users/youruser/podcast-inbox</string>
    <key>PODSHELF_URL</key>
    <string>http://localhost:3000</string>
    <key>PODSHELF_ADMIN_PASSWORD</key>
    <string>yourpassword</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/podshelf-watch.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/podshelf-watch.log</string>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
```

Load it:
```bash
launchctl load ~/Library/LaunchAgents/com.podshelf.watch.plist
```

---

## Full Workflow Example

Here's the complete workflow for a *You Said 100 Miles?* episode:

### 1. Record and Export

Record your episode in your DAW of choice. Export as MP3 (128-192 kbps is fine for podcasts).

### 2. Transcribe with Whisper

```bash
# Install whisper
pip install openai-whisper

# Transcribe your audio
whisper "western-states-recap.mp3" \
  --model medium \
  --output_format txt \
  --output_dir "/tmp/ws-recap/"
```

### 3. Prepare Episode Folder

```bash
mkdir -p ~/podcast-inbox/ep-042-western-states-recap

# Copy audio
cp western-states-recap.mp3 ~/podcast-inbox/ep-042-western-states-recap/

# Copy transcript
cp /tmp/ws-recap/western-states-recap.txt \
   ~/podcast-inbox/ep-042-western-states-recap/episode.txt

# Optionally add your own notes to episode.txt before dropping it
```

### 4. Drop the Folder (watcher does the rest)

The moment you copy/move the folder into `$WATCH_DIR`, the watcher picks it up:

```
[podshelf-watch] INFO  Processing episode folder: ep-042-western-states-recap
[podshelf-watch] INFO  Uploading audio: western-states-recap.mp3
[podshelf-watch] INFO  Upload complete: https://f004.backblazeb2.com/file/mypodcast/western-states-recap.mp3
[podshelf-watch] INFO  Generating show notes via Claude CLI from: episode.txt
[podshelf-watch] INFO  Show notes generated successfully (1842 chars)
[podshelf-watch] INFO  Creating episode: Ep 042 Western States Recap
[podshelf-watch] INFO  Episode created! ID: 42 — Edit at: https://mypodcast.example.com/admin/episodes/42
[podshelf-watch] INFO  Done processing: Ep 042 Western States Recap (episode ID: 42)
```

### 5. Review and Publish

1. Open the link from the log (or your Discord notification)
2. Review/edit the AI-generated show notes
3. Set the episode number
4. Hit **Publish** — the episode is live and in the RSS feed immediately

---

## Troubleshooting

### "No audio file found"
Make sure your audio file has a `.mp3` or `.m4a` extension (lowercase or uppercase).

### "claude: command not found"
Install Claude CLI: `npm install -g @anthropic-ai/claude-code`
Or disable Claude: `USE_CLAUDE=false`

### "Upload failed"
- Check that Podshelf is running and accessible at `$PODSHELF_URL`
- Verify `PODSHELF_ADMIN_PASSWORD` matches `ADMIN_PASSWORD` in your Podshelf `.env`
- Check Podshelf server logs for detailed error messages

### "jq: command not found"
Install jq: `sudo apt install jq` (Linux) or `brew install jq` (macOS)

### Folder not being detected on macOS
Make sure fswatch is installed: `brew install fswatch`
Test fswatch directly: `fswatch ~/podcast-inbox`
