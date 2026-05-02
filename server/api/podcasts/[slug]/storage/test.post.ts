import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import { loadPodcastStorage, type SftpConfig, type S3Config } from '../../../../utils/storage-config'
import { testSftpConnection } from '../../../../storage/sftp'
import { testS3Connection } from '../../../../storage/s3'

/**
 * POST /api/podcasts/[slug]/storage/test
 *
 * Tries to connect to the configured storage. Body shape:
 *   { adapter: 'sftp'|'s3', config: <partial config> }
 *
 * If a secret-bearing field (privateKey, password, secretAccessKey) is
 * blank in the body, falls back to whatever is saved in the DB. Lets the
 * user verify a saved config without re-entering secrets.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)

  const body = await readBody(event)
  const adapter = body?.adapter as string
  const incoming = (body?.config || {}) as Record<string, unknown>

  if (adapter !== 'sftp' && adapter !== 's3') {
    throw createError({ statusCode: 400, statusMessage: 'adapter must be "sftp" or "s3"' })
  }

  const saved = loadPodcastStorage(podcastId)

  try {
    if (adapter === 'sftp') {
      const config: SftpConfig = {
        host: String(incoming.host || ''),
        port: Number(incoming.port) || 22,
        username: String(incoming.username || ''),
        privateKey: incoming.privateKey ? String(incoming.privateKey) : undefined,
        passphrase: incoming.passphrase ? String(incoming.passphrase) : undefined,
        password: incoming.password ? String(incoming.password) : undefined,
        remoteDir: String(incoming.remoteDir || ''),
        publicUrlBase: String(incoming.publicUrlBase || ''),
      }
      if (!config.privateKey && !config.password && saved?.adapter === 'sftp' && saved.sftp) {
        config.privateKey = saved.sftp.privateKey
        config.password = saved.sftp.password
        if (!config.passphrase) config.passphrase = saved.sftp.passphrase
      }
      const result = await testSftpConnection(config)
      return result
    }

    const config: S3Config = {
      endpoint: incoming.endpoint ? String(incoming.endpoint) : undefined,
      region: String(incoming.region || 'us-east-1'),
      accessKeyId: String(incoming.accessKeyId || ''),
      secretAccessKey: incoming.secretAccessKey ? String(incoming.secretAccessKey) : '',
      bucketName: String(incoming.bucketName || ''),
      publicUrlBase: String(incoming.publicUrlBase || ''),
    }
    if (!config.secretAccessKey && saved?.adapter === 's3' && saved.s3) {
      config.secretAccessKey = saved.s3.secretAccessKey
    }
    const result = await testS3Connection(config)
    return result
  } catch (err: unknown) {
    throw createError({
      statusCode: 400,
      statusMessage: err instanceof Error ? err.message : 'Connection test failed',
    })
  }
})
