import Database from 'better-sqlite3'
import { mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'

// Inlined schema — avoids file-read issues in Nitro production builds
const SCHEMA_SQL = `
-- Episodes table
CREATE TABLE IF NOT EXISTS episodes (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  title                   TEXT NOT NULL,
  slug                    TEXT UNIQUE NOT NULL,
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
  updated_at              TEXT DEFAULT (datetime('now'))
);

-- Settings key/value store
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- Seed default settings if they don't exist
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('show_title',       'My Podcast'),
  ('show_description', 'A podcast about things I care about.'),
  ('show_author',      ''),
  ('show_email',       ''),
  ('show_image_url',   ''),
  ('show_language',    'en'),
  ('show_copyright',   ''),
  ('show_category',    'Society & Culture'),
  ('show_explicit',    'false'),
  ('show_website',     ''),
  ('audio_tracking_prefix', ''),
  ('geoip_db_path', '');

-- Downloads tracking table
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
  // databasePath is resolved to absolute at build time in nuxt.config.ts
  const resolvedPath = config.databasePath
  const dir = dirname(resolvedPath)

  // Ensure the data directory exists
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const db = new Database(resolvedPath)

  // Performance settings
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Run schema migration
  db.exec(SCHEMA_SQL)

  return db
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

// Default export for convenience
export const db = {
  get instance(): Database.Database {
    return getDb()
  },
}

export default getDb
