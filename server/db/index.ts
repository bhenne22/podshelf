import Database from 'better-sqlite3'
import { mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'

// Inlined schema — avoids file-read issues in Nitro production builds.
// Mirror of server/db/schema.sql; update both when changing.
const SCHEMA_SQL = `
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

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  podcast_id  INTEGER REFERENCES podcasts(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   INTEGER,
  summary     TEXT,
  details     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_podcast_id ON audit_log(podcast_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);

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
  const resolvedPath = config.databasePath
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
