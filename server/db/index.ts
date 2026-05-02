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
