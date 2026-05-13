import { defineEventHandler, getRouterParam } from 'h3'
import { requireNetworkReadAccess } from '../../../utils/auth'
import getDb from '../../../db/index'

/**
 * GET /api/networks/[slug]/property-definitions
 *
 * Lists the network's custom property schema. Definitions are network-wide
 * metadata, so the response is the same regardless of which podcasts a
 * scoped API key has access to.
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { networkId } = requireNetworkReadAccess(event, slug)

  const db = getDb()
  return db.prepare(`
    SELECT id, key, label, type, required, position
    FROM network_property_definitions
    WHERE network_id = ?
    ORDER BY position, key
  `).all(networkId)
})
