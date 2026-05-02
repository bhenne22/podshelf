import { defineEventHandler, readBody, createError } from 'h3'
import { requireAdmin } from '../../utils/auth'
import { hashPassword } from '../../utils/password'
import getDb from '../../db/index'

/**
 * POST /api/users
 *
 * Admin-only. Creates a new user.
 * Body: { email, password, is_admin? }
 */
export default defineEventHandler(async (event) => {
  requireAdmin(event)

  const body = await readBody(event)
  const email = String(body?.email || '').trim().toLowerCase()
  const password = String(body?.password || '')
  const isAdmin = body?.is_admin ? 1 : 0

  if (!email || !email.includes('@')) {
    throw createError({ statusCode: 400, statusMessage: 'Valid email is required' })
  }
  if (password.length < 8) {
    throw createError({ statusCode: 400, statusMessage: 'Password must be at least 8 characters' })
  }

  const db = getDb()
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    throw createError({ statusCode: 409, statusMessage: 'User already exists' })
  }

  const result = db.prepare(`
    INSERT INTO users (email, password_hash, is_admin) VALUES (?, ?, ?)
  `).run(email, hashPassword(password), isAdmin)

  event.node.res.statusCode = 201
  return db.prepare(`
    SELECT id, email, is_admin, created_at, updated_at FROM users WHERE id = ?
  `).get(result.lastInsertRowid)
})
