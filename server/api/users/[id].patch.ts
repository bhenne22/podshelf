import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requireAdmin } from '../../utils/auth'
import { hashPassword } from '../../utils/password'
import getDb from '../../db/index'

/**
 * PATCH /api/users/[id]
 *
 * Admin-only. Updates email, password, and/or is_admin flag.
 */
export default defineEventHandler(async (event) => {
  requireAdmin(event)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const body = await readBody(event)
  const db = getDb()

  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(id) as { id: number } | undefined
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'User not found' })

  const updates: string[] = []
  const values: Record<string, unknown> = { id }

  if (typeof body?.email === 'string') {
    const email = body.email.trim().toLowerCase()
    if (!email.includes('@')) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid email' })
    }
    updates.push('email = @email')
    values.email = email
  }
  if (typeof body?.password === 'string') {
    if (body.password.length < 8) {
      throw createError({ statusCode: 400, statusMessage: 'Password must be at least 8 characters' })
    }
    updates.push('password_hash = @password_hash')
    values.password_hash = hashPassword(body.password)
  }
  if (body?.is_admin !== undefined) {
    updates.push('is_admin = @is_admin')
    values.is_admin = body.is_admin ? 1 : 0
  }
  if ('full_name' in (body || {})) {
    const v = body.full_name == null ? null : String(body.full_name).trim()
    updates.push('full_name = @full_name')
    values.full_name = v && v.length ? v : null
  }
  if ('display_name' in (body || {})) {
    const v = body.display_name == null ? null : String(body.display_name).trim()
    updates.push('display_name = @display_name')
    values.display_name = v && v.length ? v : null
  }

  if (!updates.length) {
    throw createError({ statusCode: 400, statusMessage: 'No valid fields to update' })
  }

  updates.push(`updated_at = datetime('now')`)
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = @id`).run(values)

  return db.prepare(`
    SELECT id, email, is_admin, full_name, display_name, created_at, updated_at FROM users WHERE id = ?
  `).get(id)
})
