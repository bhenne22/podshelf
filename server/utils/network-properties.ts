import { createError } from 'h3'

export type PropertyType = 'string' | 'boolean' | 'number' | 'url' | 'color'

export const PROPERTY_TYPES: PropertyType[] = ['string', 'boolean', 'number', 'url', 'color']

const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/

export function isPropertyType(value: unknown): value is PropertyType {
  return typeof value === 'string' && (PROPERTY_TYPES as readonly string[]).includes(value)
}

export function validatePropertyKey(key: unknown): string {
  if (typeof key !== 'string' || !KEY_RE.test(key)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'key must start with a letter and contain only letters, digits, and underscores',
    })
  }
  return key
}

/**
 * Throws 400 if the raw value doesn't fit the declared type. Returns the
 * normalized TEXT form to persist (or null when blank/cleared). All values
 * are stored as TEXT in network_podcast_properties; coercion to the typed
 * shape happens on read via coercePropertyValue.
 */
export function normalizePropertyValue(type: PropertyType, raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null
  switch (type) {
    case 'boolean': {
      if (raw === true) return 'true'
      if (raw === false) return 'false'
      const s = String(raw).toLowerCase()
      if (s === 'true' || s === '1') return 'true'
      if (s === 'false' || s === '0') return 'false'
      throw createError({ statusCode: 400, statusMessage: 'value must be a boolean' })
    }
    case 'number': {
      const n = Number(raw)
      if (!Number.isFinite(n)) {
        throw createError({ statusCode: 400, statusMessage: 'value must be a finite number' })
      }
      return String(n)
    }
    case 'url': {
      try {
        new URL(String(raw))
      } catch {
        throw createError({ statusCode: 400, statusMessage: 'value must be a valid URL' })
      }
      return String(raw)
    }
    case 'color': {
      const s = String(raw)
      if (!/^#[0-9a-fA-F]{6}$/.test(s)) {
        throw createError({ statusCode: 400, statusMessage: 'value must be a 6-digit hex color (#rrggbb)' })
      }
      return s.toLowerCase()
    }
    case 'string':
    default:
      return String(raw)
  }
}

/**
 * Project stored TEXT back to the declared type for the read API. Booleans
 * become JSON true/false, numbers become JSON numbers; url/color/string stay
 * as strings. Consumers receive a typed value directly without having to
 * parse based on the def's type.
 */
export function coercePropertyValue(
  type: PropertyType,
  raw: string | null,
): string | number | boolean | null {
  if (raw === null) return null
  switch (type) {
    case 'boolean': return raw === 'true'
    case 'number':  return Number(raw)
    default:        return raw
  }
}

/**
 * Used by the def-PATCH handler when changing type. Returns the first value
 * that wouldn't coerce under the new type, or null if every value is safe.
 * Surfaces the conflict to the admin so the type change is rejected with a
 * 409 instead of silently breaking the consumer.
 */
export function findUncoercible(values: (string | null)[], newType: PropertyType): string | null {
  for (const v of values) {
    if (v === null) continue
    try {
      normalizePropertyValue(newType, v)
    } catch {
      return v
    }
  }
  return null
}
