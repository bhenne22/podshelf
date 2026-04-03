#!/usr/bin/env bash
# =============================================================================
# podshelf-watch.sh
# Part of the OpenClaw integration for Podshelf.
#
# Watches a directory for new episode folders, uploads audio files, optionally
# generates show notes via Claude CLI, then creates draft episodes via the
# Podshelf API.
#
# Usage:
#   chmod +x podshelf-watch.sh
#   ./podshelf-watch.sh
#
# Or run in background:
#   nohup ./podshelf-watch.sh >> /var/log/podshelf-watch.log 2>&1 &
#
# Requirements:
#   Linux:  inotifywait  (apt install inotify-tools)
#   macOS:  fswatch      (brew install fswatch)
#   Both:   curl, jq
#   Optional: claude CLI  (npm install -g @anthropic-ai/claude-code)
#             jq          (apt install jq / brew install jq)
#
# Episode folder structure:
#   $WATCH_DIR/
#     my-episode-title/
#       audio.mp3         <- required (any .mp3 or .m4a file)
#       episode.txt       <- optional transcript / notes for Claude
#
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration — override with environment variables
# ---------------------------------------------------------------------------
WATCH_DIR="${WATCH_DIR:-$HOME/podcast-inbox}"
PODSHELF_URL="${PODSHELF_URL:-http://localhost:3000}"
PODSHELF_API_KEY="${PODSHELF_API_KEY:-}"
DISCORD_WEBHOOK_URL="${DISCORD_WEBHOOK_URL:-}"
USE_CLAUDE="${USE_CLAUDE:-true}"
CLAUDE_PROMPT_PREFIX="${CLAUDE_PROMPT_PREFIX:-Generate engaging podcast show notes in HTML format (use <p>, <ul>, <li>, <a> tags). Include a brief summary, key topics covered, and any notable quotes or timestamps mentioned. Keep it under 600 words. Transcript:}"
LOG_PREFIX="[podshelf-watch]"

# ---------------------------------------------------------------------------
# Logging helpers
# ---------------------------------------------------------------------------
log_info()  { echo "$LOG_PREFIX INFO  $(date '+%Y-%m-%d %H:%M:%S') $*"; }
log_warn()  { echo "$LOG_PREFIX WARN  $(date '+%Y-%m-%d %H:%M:%S') $*" >&2; }
log_error() { echo "$LOG_PREFIX ERROR $(date '+%Y-%m-%d %H:%M:%S') $*" >&2; }

# ---------------------------------------------------------------------------
# Detect OS and watcher tool
# ---------------------------------------------------------------------------
detect_watcher() {
  if command -v inotifywait &>/dev/null; then
    echo "inotifywait"
  elif command -v fswatch &>/dev/null; then
    echo "fswatch"
  else
    log_error "No filesystem watcher found. Install inotify-tools (Linux) or fswatch (macOS)."
    log_error "  Linux: sudo apt install inotify-tools"
    log_error "  macOS: brew install fswatch"
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Slugify: convert a string to a URL-safe slug
# ---------------------------------------------------------------------------
slugify() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-//;s/-$//'
}

# ---------------------------------------------------------------------------
# Find the audio file in an episode folder
# Returns the path or empty string if not found.
# ---------------------------------------------------------------------------
find_audio_file() {
  local dir="$1"
  local audio_file=""
  # Prefer .mp3, then .m4a
  audio_file=$(find "$dir" -maxdepth 1 \( -iname "*.mp3" -o -iname "*.m4a" \) | head -n 1)
  echo "$audio_file"
}

# ---------------------------------------------------------------------------
# Upload audio file to Podshelf
# Prints the public URL on success, empty string on failure.
# ---------------------------------------------------------------------------
upload_audio() {
  local filepath="$1"
  local filename
  filename="$(basename "$filepath")"

  log_info "Uploading audio: $filename"

  local response
  response=$(curl -s -X POST \
    ${PODSHELF_API_KEY:+-H "X-Api-Key: $PODSHELF_API_KEY"} \
    -F "file=@${filepath}" \
    "${PODSHELF_URL}/api/upload" 2>&1) || {
      log_error "Upload curl command failed for: $filename"
      echo ""
      return 1
    }

  local url
  url=$(echo "$response" | jq -r '.url // empty' 2>/dev/null)

  if [ -z "$url" ]; then
    log_error "Upload failed. Response: $response"
    echo ""
    return 1
  fi

  log_info "Upload complete: $url"
  echo "$url"
}

# ---------------------------------------------------------------------------
# Generate show notes using Claude CLI from a transcript file
# Prints the HTML show notes on success, empty string if unavailable/failed.
# ---------------------------------------------------------------------------
generate_show_notes() {
  local transcript_path="$1"

  if [ "$USE_CLAUDE" != "true" ]; then
    echo ""
    return 0
  fi

  if ! command -v claude &>/dev/null; then
    log_warn "claude CLI not found. Skipping show notes generation."
    log_warn "Install with: npm install -g @anthropic-ai/claude-code"
    echo ""
    return 0
  fi

  if [ ! -f "$transcript_path" ]; then
    echo ""
    return 0
  fi

  log_info "Generating show notes via Claude CLI from: $(basename "$transcript_path")"

  local transcript
  transcript=$(cat "$transcript_path")

  local show_notes
  show_notes=$(echo "$CLAUDE_PROMPT_PREFIX

$transcript" | claude -p 2>/dev/null) || {
    log_warn "Claude CLI failed. Show notes will be empty."
    echo ""
    return 0
  }

  log_info "Show notes generated successfully (${#show_notes} chars)"
  echo "$show_notes"
}

# ---------------------------------------------------------------------------
# Create draft episode via Podshelf API
# ---------------------------------------------------------------------------
create_episode() {
  local title="$1"
  local slug="$2"
  local audio_url="$3"
  local audio_size="$4"
  local description="$5"
  local episode_number="${6:-}"

  log_info "Creating episode: $title"

  # Build JSON payload
  local json_body
  json_body=$(jq -n \
    --arg title "$title" \
    --arg slug "$slug" \
    --arg audio_url "$audio_url" \
    --argjson audio_size_bytes "${audio_size:-0}" \
    --arg description "$description" \
    --arg status "draft" \
    '{
      title: $title,
      slug: $slug,
      audio_url: $audio_url,
      audio_size_bytes: $audio_size_bytes,
      description: $description,
      status: $status
    } + (if $ENV.EPISODE_NUMBER != "" then {episode_number: ($ENV.EPISODE_NUMBER | tonumber)} else {} end)'
  )

  local response
  response=$(curl -s -X POST \
    ${PODSHELF_API_KEY:+-H "X-Api-Key: $PODSHELF_API_KEY"} \
    -H "Content-Type: application/json" \
    -d "$json_body" \
    "${PODSHELF_URL}/api/episodes" 2>&1) || {
      log_error "Failed to create episode via API"
      return 1
    }

  local episode_id
  episode_id=$(echo "$response" | jq -r '.id // empty' 2>/dev/null)

  if [ -z "$episode_id" ]; then
    log_error "Failed to create episode. Response: $response"
    return 1
  fi

  log_info "Episode created! ID: $episode_id — Edit at: ${PODSHELF_URL}/admin/episodes/${episode_id}"
  echo "$episode_id"
}

# ---------------------------------------------------------------------------
# Notify Discord webhook
# ---------------------------------------------------------------------------
notify_discord() {
  local message="$1"

  if [ -z "$DISCORD_WEBHOOK_URL" ]; then
    return 0
  fi

  curl -s -X POST \
    -H "Content-Type: application/json" \
    -d "{\"content\": $(echo "$message" | jq -R -s .)}" \
    "$DISCORD_WEBHOOK_URL" >/dev/null 2>&1 || true
}

# ---------------------------------------------------------------------------
# Process a single episode directory
# ---------------------------------------------------------------------------
process_episode_dir() {
  local dir="$1"
  local folder_name
  folder_name="$(basename "$dir")"

  log_info "Processing episode folder: $folder_name"

  # Derive episode title from folder name (convert hyphens/underscores to spaces, title case)
  local title
  title=$(echo "$folder_name" | sed 's/[-_]/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2); print}')
  local slug
  slug=$(slugify "$folder_name")

  # 1. Find audio file
  local audio_file
  audio_file=$(find_audio_file "$dir")

  if [ -z "$audio_file" ]; then
    log_warn "No audio file found in: $dir — skipping."
    return 0
  fi

  local audio_size
  audio_size=$(wc -c < "$audio_file" | tr -d ' ')

  # 2. Upload audio
  local audio_url
  audio_url=$(upload_audio "$audio_file")

  if [ -z "$audio_url" ]; then
    log_error "Audio upload failed for: $folder_name — skipping episode creation."
    notify_discord "Podshelf: Upload FAILED for episode \"$title\". Check server logs."
    return 1
  fi

  # 3. Generate show notes from transcript (if present)
  local transcript_path="$dir/episode.txt"
  local description=""

  if [ -f "$transcript_path" ]; then
    description=$(generate_show_notes "$transcript_path")
  fi

  # Fallback description
  if [ -z "$description" ]; then
    description="<p>$title</p>"
  fi

  # 4. Create episode
  local episode_id
  episode_id=$(create_episode "$title" "$slug" "$audio_url" "$audio_size" "$description")

  if [ -z "$episode_id" ]; then
    notify_discord "Podshelf: Failed to create episode record for \"$title\"."
    return 1
  fi

  # 5. Mark folder as processed (rename to prevent re-processing)
  mv "$dir" "${dir}.processed" || true

  # 6. Discord notification
  notify_discord "Podshelf: New episode draft created — \"$title\" (ID: $episode_id). Edit at: ${PODSHELF_URL}/admin/episodes/${episode_id}"

  log_info "Done processing: $title (episode ID: $episode_id)"
}

# ---------------------------------------------------------------------------
# Main watch loop — Linux (inotifywait)
# ---------------------------------------------------------------------------
watch_linux() {
  log_info "Watching (inotifywait): $WATCH_DIR"

  while true; do
    # Wait for a new directory to be created
    local event_path
    event_path=$(inotifywait -q -e create --format '%w%f' "$WATCH_DIR" 2>/dev/null)

    if [ -d "$event_path" ]; then
      # Small delay to allow file writes to complete
      sleep 3
      process_episode_dir "$event_path" || log_error "Failed to process: $event_path"
    fi
  done
}

# ---------------------------------------------------------------------------
# Main watch loop — macOS (fswatch)
# ---------------------------------------------------------------------------
watch_macos() {
  log_info "Watching (fswatch): $WATCH_DIR"

  fswatch -0 -e ".*" -i "/$" "$WATCH_DIR" | while IFS= read -r -d '' event_path; do
    if [ -d "$event_path" ] && [[ "$event_path" != *.processed ]]; then
      sleep 3
      process_episode_dir "$event_path" || log_error "Failed to process: $event_path"
    fi
  done
}

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
main() {
  log_info "Starting Podshelf OpenClaw watcher"
  log_info "Podshelf URL: $PODSHELF_URL"
  log_info "Watch directory: $WATCH_DIR"
  log_info "Claude show notes: $USE_CLAUDE"
  if [ -z "$PODSHELF_API_KEY" ]; then
    log_warn "PODSHELF_API_KEY is not set — API calls will fail if ADMIN_PASSWORD is configured on the server."
  fi

  # Validate dependencies
  if ! command -v curl &>/dev/null; then
    log_error "curl is required but not installed."
    exit 1
  fi

  if ! command -v jq &>/dev/null; then
    log_error "jq is required but not installed. Install with: apt install jq / brew install jq"
    exit 1
  fi

  # Create watch directory if it doesn't exist
  mkdir -p "$WATCH_DIR"

  # Process any existing unprocessed directories on startup
  log_info "Checking for existing unprocessed episode folders..."
  while IFS= read -r -d '' dir; do
    if [[ "$dir" != *.processed ]]; then
      process_episode_dir "$dir" || log_error "Startup processing failed: $dir"
    fi
  done < <(find "$WATCH_DIR" -mindepth 1 -maxdepth 1 -type d -print0 2>/dev/null)

  # Start watching
  local watcher
  watcher=$(detect_watcher)

  case "$watcher" in
    inotifywait) watch_linux ;;
    fswatch)     watch_macos ;;
    *) log_error "Unknown watcher: $watcher"; exit 1 ;;
  esac
}

main "$@"
