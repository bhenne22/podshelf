-- Podshelf Database Schema
-- SQLite via better-sqlite3
-- NOTE: this file is mirrored inline in server/db/index.ts (SCHEMA_SQL).
-- Update both when changing.

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  is_admin       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS podcasts (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  slug                     TEXT UNIQUE NOT NULL,
  title                    TEXT NOT NULL,
  description              TEXT,
  author                   TEXT,
  email                    TEXT,
  image_url                TEXT,
  language                 TEXT DEFAULT 'en',
  copyright                TEXT,
  category                 TEXT DEFAULT 'Society & Culture',
  explicit                 TEXT DEFAULT 'false',
  website                  TEXT,
  audio_tracking_prefix    TEXT,
  storage_adapter          TEXT DEFAULT 'sftp',
  storage_config_encrypted TEXT,
  github_owner             TEXT,
  github_repo              TEXT,
  github_event_type        TEXT,
  github_token_encrypted   TEXT,
  github_auto_trigger      INTEGER NOT NULL DEFAULT 0,
  created_at               TEXT DEFAULT (datetime('now')),
  updated_at               TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS podcast_users (
  podcast_id  INTEGER NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (podcast_id, user_id)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash      TEXT UNIQUE NOT NULL,
  label         TEXT,
  expires_at    TEXT,
  disabled      INTEGER NOT NULL DEFAULT 0,
  permissions   TEXT NOT NULL DEFAULT 'full',
  created_at    TEXT DEFAULT (datetime('now')),
  last_used_at  TEXT
);

-- If an api_key has zero rows here, it's unrestricted (inherits all of the
-- owning user's podcast access). If it has any rows, it's restricted to
-- exactly those podcasts.
CREATE TABLE IF NOT EXISTS api_key_podcasts (
  api_key_id  INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  podcast_id  INTEGER NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  PRIMARY KEY (api_key_id, podcast_id)
);

CREATE TABLE IF NOT EXISTS episodes (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  podcast_id              INTEGER NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  title                   TEXT NOT NULL,
  slug                    TEXT NOT NULL,
  episode_number          INTEGER,
  season_number           INTEGER,
  description             TEXT,
  audio_url               TEXT,
  audio_filename          TEXT,
  audio_size_bytes        INTEGER,
  audio_duration_seconds  INTEGER,
  published_at            TEXT,
  status                  TEXT DEFAULT 'draft',
  tags                    TEXT,
  transcript_path         TEXT,
  created_at              TEXT DEFAULT (datetime('now')),
  updated_at              TEXT DEFAULT (datetime('now')),
  UNIQUE (podcast_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_episodes_podcast_id ON episodes(podcast_id);

CREATE TABLE IF NOT EXISTS downloads (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id       INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  downloaded_at    TEXT NOT NULL DEFAULT (datetime('now')),
  ip_hash          TEXT NOT NULL,
  user_agent       TEXT,
  bytes_requested  INTEGER,
  country          TEXT,
  region           TEXT,
  city             TEXT
);

CREATE INDEX IF NOT EXISTS idx_downloads_episode_id ON downloads(episode_id);
CREATE INDEX IF NOT EXISTS idx_downloads_downloaded_at ON downloads(downloaded_at);
CREATE INDEX IF NOT EXISTS idx_downloads_ip_hash_episode ON downloads(ip_hash, episode_id);
