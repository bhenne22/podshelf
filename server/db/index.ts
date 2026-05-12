import Database from 'better-sqlite3'
import { mkdirSync, existsSync } from 'fs'
import { dirname, resolve } from 'path'

// Inlined schema — avoids file-read issues in Nitro production builds.
// Mirror of server/db/schema.sql; update both when changing.
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  is_admin       INTEGER NOT NULL DEFAULT 0,
  full_name      TEXT,
  display_name   TEXT,
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
  publish_dirty_first_at   TEXT,
  publish_dirty_last_at    TEXT,
  build_admin_only         INTEGER NOT NULL DEFAULT 1,
  status                   TEXT NOT NULL DEFAULT 'active',
  lifecycle                TEXT NOT NULL DEFAULT 'active',
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
  timezone                 TEXT NOT NULL DEFAULT 'UTC',
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

CREATE TABLE IF NOT EXISTS api_key_podcasts (
  api_key_id  INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  podcast_id  INTEGER NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  PRIMARY KEY (api_key_id, podcast_id)
);

-- INVARIANT: episodes.updated_at must advance whenever ANY change affects the
-- rendered episode payload — including writes to related tables. Downstream
-- static-site builds use this column as a "this episode is stale" signal to
-- avoid re-fetching unchanged data (see docs/incremental-sync-design.md).
--
-- Concretely that means a bump on:
--   * direct column updates (handled by episodes/[id].patch.ts)
--   * chapters_url / transcript_path writes (handled by upload handlers)
--   * episode_people attach/update/detach (people endpoints under episodes/)
--   * people row updates that change render-affecting fields (name/img/href)
--     → cascade to every episode the person is attached to
--   * people row deletes → cascade BEFORE the delete (FK ON DELETE CASCADE
--     wipes episode_people, so the affected-episode set must be captured first)
--   * any future write that affects the rendered payload
--
-- If you add a handler that touches state visible through the episode
-- projection, bump updated_at or the invariant breaks silently. The
-- updated-at-cascade.test.ts suite pins the non-obvious cases.
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

CREATE TABLE IF NOT EXISTS slug_aliases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  podcast_id  INTEGER NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  old_slug    TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_slug_aliases_podcast_id ON slug_aliases(podcast_id);

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
`

let _db: Database.Database | null = null

function initDb(): Database.Database {
  const config = useRuntimeConfig()
  // Prefer the runtime env var (set by systemd EnvironmentFile in production)
  // over the build-time default; resolve here so a relative path becomes
  // absolute against the current working dir, not the build machine's CWD.
  const rawPath = process.env.DATABASE_PATH || config.databasePath
  const resolvedPath = resolve(rawPath)
  const dir = dirname(resolvedPath)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const db = new Database(resolvedPath)

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(SCHEMA_SQL)
  applyMigrations(db)

  return db
}

/**
 * Add columns / indexes that may be missing from older databases.
 * Each step is a no-op if the change already exists.
 */
function applyMigrations(db: Database.Database) {
  const cols = (table: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)

  const userCols = cols('users')
  if (!userCols.includes('full_name')) {
    db.exec('ALTER TABLE users ADD COLUMN full_name TEXT')
  }
  if (!userCols.includes('display_name')) {
    db.exec('ALTER TABLE users ADD COLUMN display_name TEXT')
  }

  const apiKeyCols = cols('api_keys')
  if (!apiKeyCols.includes('expires_at')) {
    db.exec('ALTER TABLE api_keys ADD COLUMN expires_at TEXT')
  }
  if (!apiKeyCols.includes('disabled')) {
    db.exec('ALTER TABLE api_keys ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0')
  }
  if (!apiKeyCols.includes('permissions')) {
    db.exec("ALTER TABLE api_keys ADD COLUMN permissions TEXT NOT NULL DEFAULT 'full'")
  }

  const podcastCols = cols('podcasts')
  if (!podcastCols.includes('github_auto_trigger')) {
    db.exec('ALTER TABLE podcasts ADD COLUMN github_auto_trigger INTEGER NOT NULL DEFAULT 0')
  }
  if (!podcastCols.includes('status')) {
    db.exec("ALTER TABLE podcasts ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
  }
  if (!podcastCols.includes('deleted_at')) {
    db.exec('ALTER TABLE podcasts ADD COLUMN deleted_at TEXT')
  }
  if (!podcastCols.includes('guid')) {
    db.exec('ALTER TABLE podcasts ADD COLUMN guid TEXT')
  }
  if (!podcastCols.includes('itunes_type')) {
    db.exec("ALTER TABLE podcasts ADD COLUMN itunes_type TEXT NOT NULL DEFAULT 'episodic'")
  }
  if (!podcastCols.includes('podcast_locked')) {
    db.exec("ALTER TABLE podcasts ADD COLUMN podcast_locked TEXT NOT NULL DEFAULT 'no'")
  }
  if (!podcastCols.includes('itunes_complete')) {
    db.exec("ALTER TABLE podcasts ADD COLUMN itunes_complete TEXT NOT NULL DEFAULT 'no'")
  }
  if (!podcastCols.includes('itunes_block')) {
    db.exec("ALTER TABLE podcasts ADD COLUMN itunes_block TEXT NOT NULL DEFAULT 'no'")
  }
  if (!podcastCols.includes('funding_url')) {
    db.exec('ALTER TABLE podcasts ADD COLUMN funding_url TEXT')
  }
  if (!podcastCols.includes('funding_label')) {
    db.exec('ALTER TABLE podcasts ADD COLUMN funding_label TEXT')
  }
  if (!podcastCols.includes('feed_last_modified')) {
    // SQLite ALTER TABLE ADD COLUMN can't take a non-constant default on
    // NOT NULL, so add nullable and backfill in a separate statement.
    db.exec('ALTER TABLE podcasts ADD COLUMN feed_last_modified TEXT')
    db.exec("UPDATE podcasts SET feed_last_modified = COALESCE(updated_at, datetime('now')) WHERE feed_last_modified IS NULL")
  }
  if (!podcastCols.includes('verify_txt')) {
    db.exec('ALTER TABLE podcasts ADD COLUMN verify_txt TEXT')
  }
  if (!podcastCols.includes('license_identifier')) {
    db.exec('ALTER TABLE podcasts ADD COLUMN license_identifier TEXT')
  }
  if (!podcastCols.includes('license_url')) {
    db.exec('ALTER TABLE podcasts ADD COLUMN license_url TEXT')
  }
  if (!podcastCols.includes('webhook_url_encrypted')) {
    db.exec('ALTER TABLE podcasts ADD COLUMN webhook_url_encrypted TEXT')
  }
  if (!podcastCols.includes('webhook_format')) {
    db.exec("ALTER TABLE podcasts ADD COLUMN webhook_format TEXT NOT NULL DEFAULT 'generic'")
  }
  if (!podcastCols.includes('webhook_enabled')) {
    db.exec('ALTER TABLE podcasts ADD COLUMN webhook_enabled INTEGER NOT NULL DEFAULT 0')
  }
  if (!podcastCols.includes('episode_title_template')) {
    db.exec('ALTER TABLE podcasts ADD COLUMN episode_title_template TEXT')
  }
  if (!podcastCols.includes('episode_description_template')) {
    db.exec('ALTER TABLE podcasts ADD COLUMN episode_description_template TEXT')
  }
  if (!podcastCols.includes('seasons_enabled')) {
    db.exec('ALTER TABLE podcasts ADD COLUMN seasons_enabled INTEGER NOT NULL DEFAULT 1')
  }
  if (!podcastCols.includes('episode_numbers_enabled')) {
    db.exec('ALTER TABLE podcasts ADD COLUMN episode_numbers_enabled INTEGER NOT NULL DEFAULT 1')
  }
  if (!podcastCols.includes('lifecycle')) {
    db.exec("ALTER TABLE podcasts ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'active'")
  }
  if (!podcastCols.includes('build_admin_only')) {
    db.exec('ALTER TABLE podcasts ADD COLUMN build_admin_only INTEGER NOT NULL DEFAULT 1')
  }
  if (!podcastCols.includes('publish_dirty_first_at')) {
    db.exec('ALTER TABLE podcasts ADD COLUMN publish_dirty_first_at TEXT')
  }
  if (!podcastCols.includes('publish_dirty_last_at')) {
    db.exec('ALTER TABLE podcasts ADD COLUMN publish_dirty_last_at TEXT')
  }
  if (!podcastCols.includes('timezone')) {
    db.exec("ALTER TABLE podcasts ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC'")
  }

  const auditCols = cols('audit_log')
  if (!auditCols.includes('api_key_id')) {
    db.exec('ALTER TABLE audit_log ADD COLUMN api_key_id INTEGER REFERENCES api_keys(id) ON DELETE SET NULL')
  }

  const episodeCols = cols('episodes')
  if (!episodeCols.includes('image_url')) {
    db.exec('ALTER TABLE episodes ADD COLUMN image_url TEXT')
  }
  if (!episodeCols.includes('image_filename')) {
    db.exec('ALTER TABLE episodes ADD COLUMN image_filename TEXT')
  }
  if (!episodeCols.includes('guid')) {
    db.exec('ALTER TABLE episodes ADD COLUMN guid TEXT')
  }
  if (!episodeCols.includes('episode_type')) {
    db.exec("ALTER TABLE episodes ADD COLUMN episode_type TEXT NOT NULL DEFAULT 'full'")
  }
  if (!episodeCols.includes('transcript_type')) {
    db.exec('ALTER TABLE episodes ADD COLUMN transcript_type TEXT')
  }
  if (!episodeCols.includes('chapters_url')) {
    db.exec('ALTER TABLE episodes ADD COLUMN chapters_url TEXT')
  }
  if (!episodeCols.includes('itunes_title')) {
    db.exec('ALTER TABLE episodes ADD COLUMN itunes_title TEXT')
  }
  if (!episodeCols.includes('itunes_author')) {
    db.exec('ALTER TABLE episodes ADD COLUMN itunes_author TEXT')
  }
  if (!episodeCols.includes('itunes_explicit')) {
    db.exec('ALTER TABLE episodes ADD COLUMN itunes_explicit TEXT')
  }
  if (!episodeCols.includes('season_name')) {
    db.exec('ALTER TABLE episodes ADD COLUMN season_name TEXT')
  }
  if (!episodeCols.includes('episode_display')) {
    db.exec('ALTER TABLE episodes ADD COLUMN episode_display TEXT')
  }
  if (!episodeCols.includes('license_identifier')) {
    db.exec('ALTER TABLE episodes ADD COLUMN license_identifier TEXT')
  }
  if (!episodeCols.includes('license_url')) {
    db.exec('ALTER TABLE episodes ADD COLUMN license_url TEXT')
  }
}

/**
 * Returns the singleton database instance, creating it on first call.
 */
export function getDb(): Database.Database {
  if (!_db) {
    _db = initDb()
  }
  return _db
}

export const db = {
  get instance(): Database.Database {
    return getDb()
  },
}

export default getDb
