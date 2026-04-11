import { defineEventHandler, getRouterParams, getRequestIP, getHeader, sendRedirect } from 'h3'
import { createHash } from 'crypto'
import getDb from '../../db/index'
import { lookupIp } from '../../utils/geoip'

export default defineEventHandler(async (event) => {
  const params = getRouterParams(event)
  const pathStr = Array.isArray(params.path) ? params.path.join('/') : (params.path as string)

  // Reconstruct the full audio URL — try https first, then http
  const audioUrl = 'https://' + pathStr

  const db = getDb()

  // Find episode by audio_url, normalizing protocol
  const episode = db.prepare(`
    SELECT id, audio_url FROM episodes
    WHERE replace(replace(audio_url, 'https://', ''), 'http://', '') = ?
  `).get(pathStr) as { id: number; audio_url: string } | undefined

  // Always redirect even if we can't match an episode
  const redirectUrl = episode?.audio_url || audioUrl

  if (episode) {
    const ip = getRequestIP(event, { xForwardedFor: true }) || '0.0.0.0'
    const ipHash = createHash('sha256').update(ip).digest('hex')

    // IAB dedup: same ip_hash + episode within 24 hours = 1 download
    const existing = db.prepare(`
      SELECT id FROM downloads
      WHERE episode_id = ? AND ip_hash = ?
      AND downloaded_at > datetime('now', '-24 hours')
    `).get(episode.id, ipHash)

    if (!existing) {
      const userAgent = getHeader(event, 'user-agent') || null

      // Parse bytes from Range header if present
      let bytesRequested: number | null = null
      const range = getHeader(event, 'range')
      if (range) {
        const m = range.match(/bytes=(\d+)-(\d+)/)
        if (m) bytesRequested = parseInt(m[2]) - parseInt(m[1]) + 1
      }

      // Optional GeoIP
      let country: string | null = null
      let region: string | null = null
      let city: string | null = null
      const geo = await lookupIp(ip)
      if (geo) {
        country = geo.country || null
        region = geo.region || null
        city = geo.city || null
      }

      db.prepare(`
        INSERT INTO downloads (episode_id, ip_hash, user_agent, bytes_requested, country, region, city)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(episode.id, ipHash, userAgent, bytesRequested, country, region, city)
    }
  }

  return sendRedirect(event, redirectUrl, 302)
})
