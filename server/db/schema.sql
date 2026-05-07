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
  status                   TEXT NOT NULL DEFAULT 'active',
  deleted_at               TEXT,
  guid                     TEXT,
  itunes_type              TEXT NOT NULL DEFAULT 'episodic',
  podcast_locked           TEXT NOT NULL DEFAULT 'no',
  itunes_complete          TEXT NOT NULL DEFAULT 'no',
  itunes_block             TEXT NOT NULL DEFAULT 'no',
  funding_url              TEXT,
  funding_label            TEXT,
  verify_txt               TEXT,
  license_identifier       TEXT,
  license_url              TEXT,
  webhook_url_encrypted    TEXT,
  webhook_format           TEXT NOT NULL DEFAULT 'generic',
  webhook_enabled          INTEGER NOT NULL DEFAULT 0,
  episode_title_template       TEXT,
  episode_description_template TEXT,
  seasons_enabled          INTEGER NOT NULL DEFAULT 1,
  episode_numbers_enabled  INTEGER NOT NULL DEFAULT 1,
  feed_last_modified       TEXT NOT NULL DEFAULT (datetime('now')),
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
  image_url               TEXT,
  image_filename          TEXT,
  published_at            TEXT,
  status                  TEXT DEFAULT 'draft',
  tags                    TEXT,
  transcript_path         TEXT,
  transcript_type         TEXT,
  chapters_url            TEXT,
  guid                    TEXT,
  episode_type            TEXT NOT NULL DEFAULT 'full',
  itunes_title            TEXT,
  itunes_author           TEXT,
  itunes_explicit         TEXT,
  season_name             TEXT,
  episode_display         TEXT,
  license_identifier      TEXT,
  license_url             TEXT,
  created_at              TEXT DEFAULT (datetime('now')),
  updated_at              TEXT DEFAULT (datetime('now')),
  UNIQUE (podcast_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_episodes_podcast_id ON episodes(podcast_id);

CREATE TABLE IF NOT EXISTS people (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  podcast_id    INTEGER NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  img_url       TEXT,
  href          TEXT,
  default_role  TEXT NOT NULL DEFAULT 'host',
  default_group TEXT NOT NULL DEFAULT 'cast',
  auto_attach   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_people_podcast_id ON people(podcast_id);

-- role/group are captured at attach time and NOT NULL so historical
-- attribution doesn't change when a person's defaults are later edited.
CREATE TABLE IF NOT EXISTS episode_people (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id  INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  person_id   INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  "group"     TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_episode_people_episode_id ON episode_people(episode_id);
CREATE INDEX IF NOT EXISTS idx_episode_people_person_id ON episode_people(person_id);

-- Slugs that used to belong to a podcast. Permanent — we never want to
-- recycle a slug because subscribers may still be polling the old feed
-- URL. The feed handler matches by alias and serves the same content
-- with `<itunes:new-feed-url>` so modern apps auto-migrate.
CREATE TABLE IF NOT EXISTS slug_aliases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  podcast_id  INTEGER NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  old_slug    TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_slug_aliases_podcast_id ON slug_aliases(podcast_id);

-- Per-podcast list of "Listen on" destinations (Apple, Spotify, etc.).
-- Pure metadata for the operator's reference. Not surfaced in the RSS feed,
-- but exposed via the API so static-site builds can render a "Listen on"
-- section after a publish.
CREATE TABLE IF NOT EXISTS podcast_distributions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  podcast_id    INTEGER NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  url           TEXT,
  platform_id   TEXT,
  notes         TEXT,
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_podcast_distributions_podcast_id
  ON podcast_distributions(podcast_id, position);

-- Per-podcast audit trail. podcast_id is nullable so we can capture
-- platform-level events (admin actions on podcasts as a whole, etc.).
-- user_id is nullable for system-generated events (e.g. the scheduler
-- flipping a scheduled episode to published).
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  podcast_id  INTEGER REFERENCES podcasts(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  api_key_id  INTEGER REFERENCES api_keys(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   INTEGER,
  summary     TEXT,
  details     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_podcast_id ON audit_log(podcast_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);

-- One row per migration of a podcast's storage from its current adapter
-- to a new one (SFTP→S3, S3→SFTP, or like-to-like). Holds the encrypted
-- target config until completion, at which point the podcast row's
-- storage_config_encrypted is swapped to it.
CREATE TABLE IF NOT EXISTS storage_migrations (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  podcast_id               INTEGER NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  status                   TEXT NOT NULL DEFAULT 'pending',
  source_adapter           TEXT NOT NULL,
  target_adapter           TEXT NOT NULL,
  target_config_encrypted  TEXT NOT NULL,
  files_total              INTEGER NOT NULL DEFAULT 0,
  files_done               INTEGER NOT NULL DEFAULT 0,
  files_failed             INTEGER NOT NULL DEFAULT 0,
  bytes_total              INTEGER NOT NULL DEFAULT 0,
  bytes_done               INTEGER NOT NULL DEFAULT 0,
  current_file             TEXT,
  error_message            TEXT,
  started_at               TEXT,
  finished_at              TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_storage_migrations_podcast_id ON storage_migrations(podcast_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_storage_migrations_status ON storage_migrations(status);

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
