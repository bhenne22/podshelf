import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import { encryptJson } from '../../../../utils/crypto'
import { logAudit } from '../../../../utils/audit'
import { isMigrationActive } from '../../../../utils/storage-migration'
import {
  loadPodcastStorage,
  type SftpConfig,
  type S3Config,
  type StorageAdapter,
} from '../../../../utils/storage-config'
import getDb from '../../../../db/index'

/**
 * POST /api/podcasts/[slug]/storage/migrate
 *
 * Body: { adapter: 'sftp'|'s3', config: SftpConfig|S3Config }
 *
 * Queues a migration from the podcast's current storage to the supplied
 * target. The in-process worker picks it up within seconds. Refuses if
 * a migration is already pending or running for this podcast.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { user, podcastId } = requirePodcastAccess(event, slug)

  const source = loadPodcastStorage(podcastId)
  if (!source || (!source.sftp && !source.s3)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Source storage is not configured. Set up storage in Settings → Storage first.',
    })
  }

  if (isMigrationActive(podcastId)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'A storage migration is already in progress for this podcast.',
    })
  }

  const body = await readBody(event)
  const adapter = body?.adapter as StorageAdapter
  const config = body?.config as SftpConfig | S3Config | undefined

  if (adapter !== 'sftp' && adapter !== 's3') {
    throw createError({ statusCode: 400, statusMessage: 'adapter must be "sftp" or "s3"' })
  }
  if (!config || typeof config !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'config object is required' })
  }

  if (adapter === 'sftp') {
    const c = config as SftpConfig
    if (!c.host || !c.username || !c.remoteDir || !c.publicUrlBase) {
      throw createError({ statusCode: 400, statusMessage: 'SFTP target needs host, username, remoteDir, publicUrlBase' })
    }
    if (!c.privateKey && !c.password) {
      throw createError({ statusCode: 400, statusMessage: 'SFTP target needs privateKey or password' })
    }
  } else {
    const c = config as S3Config
    if (!c.accessKeyId || !c.secretAccessKey || !c.bucketName || !c.publicUrlBase) {
      throw createError({ statusCode: 400, statusMessage: 'S3 target needs accessKeyId, secretAccessKey, bucketName, publicUrlBase' })
    }
  }

  // The migration worker uses PodcastStorage shape (adapter + matching config).
  const targetWrapped = adapter === 'sftp'
    ? { adapter: 'sftp' as const, sftp: config as SftpConfig }
    : { adapter: 's3' as const, s3: config as S3Config }

  const db = getDb()
  const result = db.prepare(`
    INSERT INTO storage_migrations (podcast_id, source_adapter, target_adapter, target_config_encrypted)
    VALUES (?, ?, ?, ?)
  `).run(podcastId, source.adapter, adapter, encryptJson(targetWrapped))

  logAudit({
    podcastId,
    userId: user.id,
    action: 'storage.migrate.start',
    entityType: 'podcast',
    entityId: podcastId,
    summary: `Queued storage migration ${source.adapter} → ${adapter}`,
  })

  return db.prepare('SELECT * FROM storage_migrations WHERE id = ?').get(result.lastInsertRowid)
})
