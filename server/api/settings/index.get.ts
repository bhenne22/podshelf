import { defineEventHandler } from 'h3'
import getDb from '../../db/index'

const DEFAULTS: Record<string, string> = {
  show_title: 'My Podcast',
  show_description: 'A podcast about things I care about.',
  show_author: '',
  show_email: '',
  show_image_url: '',
  show_language: 'en',
  show_copyright: '',
  show_category: 'Society & Culture',
  show_explicit: 'false',
  show_website: '',
  audio_tracking_prefix: '',
}

export default defineEventHandler(() => {
  const db = getDb()
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>

  // Start with defaults, then overlay stored values
  const result: Record<string, string> = { ...DEFAULTS }
  for (const row of rows) {
    result[row.key] = row.value
  }

  return result
})
