import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../utils/auth'
import { savePodcastStorage, type SftpConfig, type S3Config } from '../../../utils/storage-config'
import { logAudit } from '../../../utils/audit'

/**
 * POST /api/podcasts/[slug]/storage
 *
 * Body: { adapter: 'sftp'|'s3', config: SftpConfig|S3Config }
 *
 * Saves storage credentials encrypted in the podcasts row.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { user, podcastId } = requirePodcastAccess(event, slug)

  const body = await readBody(event)
  const adapter = body?.adapter as string
  const config = body?.config

  if (adapter !== 'sftp' && adapter !== 's3') {
    throw createError({ statusCode: 400, statusMessage: 'adapter must be "sftp" or "s3"' })
  }
  if (!config || typeof config !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'config object is required' })
  }

  if (adapter === 'sftp') {
    const c = config as SftpConfig
    if (!c.host || !c.username || !c.remoteDir || !c.publicUrlBase) {
      throw createError({ statusCode: 400, statusMessage: 'SFTP requires host, username, remoteDir, publicUrlBase' })
    }
    if (!c.privateKey && !c.password) {
      throw createError({ statusCode: 400, statusMessage: 'SFTP requires privateKey or password' })
    }
    if ((c.artworkRemoteDir && !c.artworkPublicUrlBase) || (!c.artworkRemoteDir && c.artworkPublicUrlBase)) {
      throw createError({ statusCode: 400, statusMessage: 'Artwork requires both artworkRemoteDir and artworkPublicUrlBase, or neither' })
    }
    savePodcastStorage(podcastId, 'sftp', c)
  } else {
    const c = config as S3Config
    if (!c.accessKeyId || !c.secretAccessKey || !c.bucketName || !c.publicUrlBase) {
      throw createError({ statusCode: 400, statusMessage: 'S3 requires accessKeyId, secretAccessKey, bucketName, publicUrlBase' })
    }
    savePodcastStorage(podcastId, 's3', c)
  }

  // Don't log credentials — just record that storage was reconfigured.
  logAudit({
    podcastId,
    userId: user.id,
    action: 'podcast.storage.update',
    entityType: 'podcast',
    entityId: podcastId,
    summary: `Updated storage configuration (${adapter})`,
  })

  return { ok: true }
})
