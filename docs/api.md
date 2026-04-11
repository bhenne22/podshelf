# Podshelf API

All mutation endpoints require authentication via one of:

- **API Key header:** `X-Api-Key: <PODSHELF_API_KEY>`
- **Bearer token:** `Authorization: Bearer <PODSHELF_API_KEY>`
- **Session cookie:** `admin_session` (set by the login endpoint, used by the admin UI)

If `ADMIN_PASSWORD` is not set, auth is disabled (dev mode).

Base URL: `http://localhost:3000` (or your configured `SITE_URL`)

---

## Episodes

### List Episodes

```
GET /api/episodes
```

**Query parameters:**

| Param  | Type   | Description                          |
|--------|--------|--------------------------------------|
| status | string | Filter by `draft` or `published`     |
| slug   | string | Fetch a single episode by slug       |

**Auth required:** No (public endpoint)

**Example:**

```bash
# All episodes
curl http://localhost:3000/api/episodes

# Published only
curl http://localhost:3000/api/episodes?status=published

# Single episode by slug
curl http://localhost:3000/api/episodes?slug=ys100m-episode-1
```

**Response:** Array of episode objects (or single episode object when using `slug`).

```json
[
  {
    "id": 1,
    "title": "Episode Title",
    "slug": "episode-title",
    "episode_number": 1,
    "season_number": 1,
    "description": "<p>HTML show notes</p>",
    "audio_url": "https://example.com/audio/episode.mp3",
    "audio_filename": "episode.mp3",
    "audio_size_bytes": 67188837,
    "audio_duration_seconds": 3600,
    "published_at": "2025-01-15T12:00:00.000Z",
    "status": "published",
    "tags": "running, ultramarathon",
    "transcript_path": null,
    "created_at": "2025-01-15T10:00:00",
    "updated_at": "2025-01-15T12:00:00"
  }
]
```

---

### Create Episode

```
POST /api/episodes
```

**Auth required:** Yes

**Request body (JSON):**

| Field                  | Type           | Required | Default  | Description                        |
|------------------------|----------------|----------|----------|------------------------------------|
| title                  | string         | Yes      |          | Episode title                      |
| slug                   | string         | No       | auto     | URL slug (auto-generated from title if omitted) |
| episode_number         | integer\|null  | No       | null     | Episode number (positive integer)  |
| season_number          | integer\|null  | No       | null     | Season number (positive integer)   |
| description            | string         | No       | null     | HTML show notes / description      |
| audio_url              | string         | No       | null     | URL to the audio file              |
| audio_filename         | string         | No       | null     | Original filename                  |
| audio_size_bytes       | integer\|null  | No       | null     | File size in bytes                 |
| audio_duration_seconds | integer\|null  | No       | null     | Duration in seconds                |
| published_at           | string\|null   | No       | null     | ISO 8601 datetime                  |
| status                 | string         | No       | "draft"  | `draft` or `published`             |
| tags                   | string         | No       | null     | Comma-separated tags               |

**Example:**

```bash
curl -X POST http://localhost:3000/api/episodes \
  -H "X-Api-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My New Episode",
    "description": "<p>Show notes here.</p>",
    "audio_url": "https://example.com/audio/episode.mp3",
    "audio_size_bytes": 67188837,
    "audio_duration_seconds": 3600,
    "status": "draft",
    "tags": "running, ultramarathon"
  }'
```

**Response:** `201 Created` with the full episode object.

---

### Update Episode

```
PATCH /api/episodes/:id
```

**Auth required:** Yes

Send only the fields you want to update. Unmentioned fields are left unchanged.

**Example:**

```bash
curl -X PATCH http://localhost:3000/api/episodes/42 \
  -H "X-Api-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "<p>Updated show notes.</p>",
    "status": "published",
    "published_at": "2025-06-01T12:00:00Z"
  }'
```

**Response:** `200 OK` with the updated episode object.

---

### Delete Episode

```
DELETE /api/episodes/:id
```

**Auth required:** Yes

**Response:** `204 No Content`

---

## Upload Audio

```
POST /api/upload
```

**Auth required:** Yes

**Content-Type:** `multipart/form-data`

Upload an audio file. The file is stored via the configured storage adapter (SFTP or S3) and a public URL is returned.

| Constraint     | Value                                              |
|----------------|----------------------------------------------------|
| Max file size  | 500 MB                                             |
| Allowed types  | audio/mpeg, audio/mp3, audio/mp4, audio/m4a, audio/aac, audio/ogg, audio/wav, audio/flac |
| Form field     | `file`                                             |

**Example:**

```bash
curl -X POST http://localhost:3000/api/upload \
  -H "X-Api-Key: your-api-key" \
  -F "file=@/path/to/episode.mp3"
```

**Response:**

```json
{
  "url": "https://example.com/audio/episode.mp3",
  "filename": "episode.mp3",
  "size": 67188837,
  "content_type": "audio/mpeg"
}
```

---

## Audio Probe

```
GET /api/audio-probe?url=<audio_url>
```

**Auth required:** Yes

Performs a HEAD request against the given URL and returns file metadata. Useful for populating `audio_size_bytes` before creating an episode.

**Example:**

```bash
curl "http://localhost:3000/api/audio-probe?url=https://example.com/audio/episode.mp3" \
  -H "X-Api-Key: your-api-key"
```

**Response:**

```json
{
  "size": 67188837,
  "contentType": "audio/mpeg"
}
```

> **Note:** This endpoint returns file size from the `Content-Length` header. Audio duration cannot be determined server-side without downloading the file. Use the admin UI "Check File" button for duration detection, or calculate it client-side with an HTML Audio element.

---

## Settings

### Get Settings

```
GET /api/settings
```

**Auth required:** No

**Response:** Key-value object of all settings with defaults applied.

```json
{
  "show_title": "You Said 100 Miles?",
  "show_description": "...",
  "show_author": "Team Puma Knife",
  "show_email": "",
  "show_image_url": "https://...",
  "show_language": "en-US",
  "show_copyright": "2023 Team Puma Knife",
  "show_category": "Sports - Running",
  "show_explicit": "true",
  "show_website": "https://www.teampumaknife.com",
  "audio_tracking_prefix": "https://media.blubrry.com/1467354/"
}
```

### Update Settings

```
POST /api/settings
```

**Auth required:** Yes

Send a JSON object with the keys to update. Only known keys are accepted.

**Allowed keys:** `show_title`, `show_description`, `show_author`, `show_email`, `show_image_url`, `show_language`, `show_copyright`, `show_category`, `show_explicit`, `show_website`, `audio_tracking_prefix`

**Example:**

```bash
curl -X POST http://localhost:3000/api/settings \
  -H "X-Api-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"show_title": "My Updated Podcast"}'
```

---

## Auth

### Login

```
POST /api/auth/login
```

**Rate limited:** 5 attempts per 15 minutes per IP.

**Request body:**

```json
{ "password": "your-admin-password" }
```

**Response:** `200 OK` with `{ "ok": true }` and sets the `admin_session` cookie.

### Logout

```
POST /api/auth/logout
```

Clears the session cookie.

---

## RSS Feed

```
GET /feed.xml
```

**Auth required:** No

Returns an iTunes-compatible RSS feed of all published episodes. The `audio_tracking_prefix` setting (if set) is prepended to audio URLs in enclosure tags, with the audio URL's protocol stripped to avoid double `https://`.

---

## Typical AI Assistant Workflow

To create a new episode via the API:

```bash
# 1. Upload the audio file
UPLOAD=$(curl -s -X POST http://localhost:3000/api/upload \
  -H "X-Api-Key: $PODSHELF_API_KEY" \
  -F "file=@episode.mp3")

AUDIO_URL=$(echo "$UPLOAD" | jq -r '.url')
AUDIO_SIZE=$(echo "$UPLOAD" | jq -r '.size')
AUDIO_FILENAME=$(echo "$UPLOAD" | jq -r '.filename')

# 2. Create the episode as a draft
curl -X POST http://localhost:3000/api/episodes \
  -H "X-Api-Key: $PODSHELF_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"Episode Title\",
    \"description\": \"<p>AI-generated show notes here.</p>\",
    \"audio_url\": \"$AUDIO_URL\",
    \"audio_filename\": \"$AUDIO_FILENAME\",
    \"audio_size_bytes\": $AUDIO_SIZE,
    \"status\": \"draft\",
    \"tags\": \"running, ultramarathon\"
  }"
```

The episode is created as a draft. Review and publish it from the admin UI at `/admin/episodes`.
