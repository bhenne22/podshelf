#!/usr/bin/env bash
#
# podshelf-publish.sh — Upload audio and create a draft episode via the Podshelf API.
#
# Usage:
#   ./scripts/podshelf-publish.sh \
#     --podcast <slug> \
#     --file /path/to/episode.mp3 \
#     --title "Episode Title" \
#     --description "<p>Show notes</p>" \
#     [--tags "tag1, tag2"] \
#     [--episode-number 5] \
#     [--season-number 2] \
#     [--status draft]
#
# Or with an existing audio URL (skip upload):
#   ./scripts/podshelf-publish.sh \
#     --podcast <slug> \
#     --audio-url "https://example.com/episode.mp3" \
#     --title "Episode Title" \
#     --description "<p>Show notes</p>"
#
# Environment:
#   PODSHELF_URL       Base URL (default: http://localhost:3000)
#   PODSHELF_API_KEY   API key for authentication (required)
#
set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────
PODSHELF_URL="${PODSHELF_URL:-http://localhost:3000}"
API_KEY="${PODSHELF_API_KEY:-}"

PODCAST=""
FILE=""
AUDIO_URL=""
TITLE=""
DESCRIPTION=""
TAGS=""
EPISODE_NUMBER=""
SEASON_NUMBER=""
STATUS="draft"

# ── Parse args ────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --podcast)        PODCAST="$2"; shift 2 ;;
    --file)           FILE="$2"; shift 2 ;;
    --audio-url)      AUDIO_URL="$2"; shift 2 ;;
    --title)          TITLE="$2"; shift 2 ;;
    --description)    DESCRIPTION="$2"; shift 2 ;;
    --tags)           TAGS="$2"; shift 2 ;;
    --episode-number) EPISODE_NUMBER="$2"; shift 2 ;;
    --season-number)  SEASON_NUMBER="$2"; shift 2 ;;
    --status)         STATUS="$2"; shift 2 ;;
    *)                echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ── Validate ──────────────────────────────────────────────────────────
if [[ -z "$API_KEY" ]]; then
  echo "Error: PODSHELF_API_KEY environment variable is required." >&2
  exit 1
fi

if [[ -z "$PODCAST" ]]; then
  echo "Error: --podcast <slug> is required." >&2
  exit 1
fi

if [[ -z "$TITLE" ]]; then
  echo "Error: --title is required." >&2
  exit 1
fi

if [[ -z "$FILE" && -z "$AUDIO_URL" ]]; then
  echo "Error: Either --file or --audio-url is required." >&2
  exit 1
fi

PODCAST_BASE="${PODSHELF_URL}/api/podcasts/${PODCAST}"

# ── Step 1: Upload audio (if --file provided) ────────────────────────
AUDIO_SIZE=""
AUDIO_FILENAME=""

if [[ -n "$FILE" ]]; then
  if [[ ! -f "$FILE" ]]; then
    echo "Error: File not found: $FILE" >&2
    exit 1
  fi

  echo "Uploading: $FILE"
  UPLOAD_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${PODCAST_BASE}/upload" \
    -H "X-Api-Key: ${API_KEY}" \
    -F "file=@${FILE}")

  HTTP_CODE=$(echo "$UPLOAD_RESPONSE" | tail -1)
  UPLOAD_BODY=$(echo "$UPLOAD_RESPONSE" | sed '$d')

  if [[ "$HTTP_CODE" -lt 200 || "$HTTP_CODE" -ge 300 ]]; then
    echo "Upload failed (HTTP $HTTP_CODE): $UPLOAD_BODY" >&2
    exit 1
  fi

  AUDIO_URL=$(echo "$UPLOAD_BODY" | jq -r '.url')
  AUDIO_SIZE=$(echo "$UPLOAD_BODY" | jq -r '.size')
  AUDIO_FILENAME=$(echo "$UPLOAD_BODY" | jq -r '.filename')
  echo "Uploaded: $AUDIO_URL ($AUDIO_SIZE bytes)"
fi

# ── Step 2: Probe for file size (if we have a URL but no size) ───────
if [[ -n "$AUDIO_URL" && -z "$AUDIO_SIZE" ]]; then
  echo "Probing audio file size..."
  PROBE_RESPONSE=$(curl -s -w "\n%{http_code}" \
    "${PODSHELF_URL}/api/audio-probe?url=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${AUDIO_URL}', safe=''))")" \
    -H "X-Api-Key: ${API_KEY}")

  PROBE_CODE=$(echo "$PROBE_RESPONSE" | tail -1)
  PROBE_BODY=$(echo "$PROBE_RESPONSE" | sed '$d')

  if [[ "$PROBE_CODE" -ge 200 && "$PROBE_CODE" -lt 300 ]]; then
    AUDIO_SIZE=$(echo "$PROBE_BODY" | jq -r '.size // empty')
    echo "File size: ${AUDIO_SIZE:-unknown}"
  else
    echo "Warning: Could not probe audio size (HTTP $PROBE_CODE)" >&2
  fi
fi

# ── Step 3: Create episode ────────────────────────────────────────────
echo "Creating episode: $TITLE"

JSON=$(jq -n \
  --arg title "$TITLE" \
  --arg description "$DESCRIPTION" \
  --arg audio_url "$AUDIO_URL" \
  --arg audio_filename "${AUDIO_FILENAME:-}" \
  --arg status "$STATUS" \
  --arg tags "$TAGS" \
  --arg episode_number "$EPISODE_NUMBER" \
  --arg season_number "$SEASON_NUMBER" \
  --arg audio_size "$AUDIO_SIZE" \
  '{
    title: $title,
    description: $description,
    audio_url: $audio_url,
    status: $status
  }
  + (if $audio_filename != "" then {audio_filename: $audio_filename} else {} end)
  + (if $tags != "" then {tags: $tags} else {} end)
  + (if $episode_number != "" then {episode_number: ($episode_number | tonumber)} else {} end)
  + (if $season_number != "" then {season_number: ($season_number | tonumber)} else {} end)
  + (if $audio_size != "" then {audio_size_bytes: ($audio_size | tonumber)} else {} end)
  ')

CREATE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${PODCAST_BASE}/episodes" \
  -H "X-Api-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$JSON")

CREATE_CODE=$(echo "$CREATE_RESPONSE" | tail -1)
CREATE_BODY=$(echo "$CREATE_RESPONSE" | sed '$d')

if [[ "$CREATE_CODE" -lt 200 || "$CREATE_CODE" -ge 300 ]]; then
  echo "Failed to create episode (HTTP $CREATE_CODE): $CREATE_BODY" >&2
  exit 1
fi

EPISODE_ID=$(echo "$CREATE_BODY" | jq -r '.id')
EPISODE_SLUG=$(echo "$CREATE_BODY" | jq -r '.slug')

echo ""
echo "Episode created successfully!"
echo "  ID:     $EPISODE_ID"
echo "  Slug:   $EPISODE_SLUG"
echo "  Status: $STATUS"
echo "  Admin:  ${PODSHELF_URL}/admin/${PODCAST}/episodes/${EPISODE_ID}"
echo ""
echo "$CREATE_BODY" | jq .
