import Database from 'better-sqlite3'
import { readFileSync, mkdirSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'

let _db: Database.Database | null = null

function initDb(): Database.Database {
  const dbPath = process.env.DATABASE_PATH || './data/podshelf.db'
  const resolvedPath = resolve(dbPath)
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
  const schemaPath = resolve('./server/db/schema.sql')
  let schemaSql: string

  try {
    schemaSql = readFileSync(schemaPath, 'utf-8')
  } catch {
    // When running from .nuxt output, try relative to the module
    const altPath = new URL('./schema.sql', import.meta.url).pathname
    schemaSql = readFileSync(altPath, 'utf-8')
  }

  db.exec(schemaSql)

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
