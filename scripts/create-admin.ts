/**
 * Create a Podshelf admin user.
 *
 * Usage:
 *   npm run create-admin
 *
 * Prompts for email and password interactively. Creates the user with
 * is_admin=1. If a user with the email already exists, the password is
 * updated and the account is promoted to admin.
 */

import Database from 'better-sqlite3'
import { mkdirSync, existsSync, readFileSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { createInterface } from 'readline'
import { randomBytes, scryptSync } from 'crypto'

function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

function loadEnv() {
  const envPath = join(process.cwd(), '.env')
  if (!existsSync(envPath)) return
  const text = readFileSync(envPath, 'utf-8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = val
  }
}

function openDb(): Database.Database {
  const dbPath = resolve(process.env.DATABASE_PATH || './data/podshelf.db')
  const dir = dirname(dbPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      email          TEXT UNIQUE NOT NULL,
      password_hash  TEXT NOT NULL,
      is_admin       INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT DEFAULT (datetime('now')),
      updated_at     TEXT DEFAULT (datetime('now'))
    );
  `)

  return db
}

// For non-TTY (piped) input, slurp all lines upfront. createInterface's
// question() doesn't reliably deliver buffered lines after the first call.
let _pipedLines: string[] | null = null
async function getPipedLines(): Promise<string[]> {
  if (_pipedLines) return _pipedLines
  let buf = ''
  process.stdin.setEncoding('utf-8')
  for await (const chunk of process.stdin) buf += chunk as string
  _pipedLines = buf.split('\n')
  return _pipedLines
}

let _rl: ReturnType<typeof createInterface> | null = null
function getRl() {
  if (!_rl) _rl = createInterface({ input: process.stdin, output: process.stdout })
  return _rl
}
function closeRl() {
  if (_rl) { _rl.close(); _rl = null }
}

async function prompt(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const lines = await getPipedLines()
    process.stdout.write(question)
    const next = lines.shift() ?? ''
    process.stdout.write(next + '\n')
    return next.trim()
  }
  return new Promise((resolveAnswer) => {
    getRl().question(question, (answer) => resolveAnswer(answer.trim()))
  })
}

const CTRL_C = ''
const DEL = ''

function promptHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) return prompt(question)
  closeRl()
  return new Promise((resolveAnswer) => {
    process.stdout.write(question)
    const stdin = process.stdin
    stdin.resume()
    stdin.setEncoding('utf-8')
    stdin.setRawMode(true)

    let value = ''
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false)
          stdin.pause()
          stdin.removeListener('data', onData)
          process.stdout.write('\n')
          return resolveAnswer(value)
        }
        if (ch === CTRL_C) {
          process.exit(130)
        }
        if (ch === DEL || ch === '\b') {
          value = value.slice(0, -1)
        } else {
          value += ch
        }
      }
    }
    stdin.on('data', onData)
  })
}

async function main() {
  loadEnv()

  console.log('Create Podshelf admin user')
  console.log('--------------------------')

  const email = (await prompt('Email: ')).toLowerCase()
  if (!email || !email.includes('@')) {
    console.error('Invalid email.')
    process.exit(1)
  }

  const password = await promptHidden('Password: ')
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.')
    process.exit(1)
  }

  const confirm = await promptHidden('Confirm password: ')
  if (password !== confirm) {
    console.error('Passwords do not match.')
    process.exit(1)
  }

  const db = openDb()
  const hash = hashPassword(password)

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: number } | undefined

  if (existing) {
    db.prepare(`
      UPDATE users
      SET password_hash = ?, is_admin = 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(hash, existing.id)
    console.log(`Updated user ${email} (id=${existing.id}); password reset and promoted to admin.`)
  } else {
    const result = db.prepare(`
      INSERT INTO users (email, password_hash, is_admin)
      VALUES (?, ?, 1)
    `).run(email, hash)
    console.log(`Created admin ${email} (id=${result.lastInsertRowid}).`)
  }

  db.close()
  closeRl()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
