import { decryptJson, encryptJson } from './crypto'
import getDb from '../db/index'

export interface SftpConfig {
  host: string
  port?: number
  username: string
  privateKey?: string
  passphrase?: string
  password?: string
  remoteDir: string
  publicUrlBase: string
}

export interface S3Config {
  endpoint?: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  bucketName: string
  publicUrlBase: string
}

export type StorageAdapter = 'sftp' | 's3'

export interface PodcastStorage {
  adapter: StorageAdapter
  sftp?: SftpConfig
  s3?: S3Config
}

export function loadPodcastStorage(podcastId: number): PodcastStorage | null {
  const db = getDb()
  const row = db.prepare(`
    SELECT storage_adapter, storage_config_encrypted FROM podcasts WHERE id = ?
  `).get(podcastId) as { storage_adapter: string; storage_config_encrypted: string | null } | undefined

  if (!row) return null
  if (!row.storage_config_encrypted) {
    return { adapter: row.storage_adapter as StorageAdapter }
  }

  const config = decryptJson<SftpConfig | S3Config>(row.storage_config_encrypted)
  if (row.storage_adapter === 's3') {
    return { adapter: 's3', s3: config as S3Config }
  }
  return { adapter: 'sftp', sftp: config as SftpConfig }
}

export function savePodcastStorage(podcastId: number, adapter: StorageAdapter, config: SftpConfig | S3Config) {
  const db = getDb()
  db.prepare(`
    UPDATE podcasts
    SET storage_adapter = ?, storage_config_encrypted = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(adapter, encryptJson(config), podcastId)
}

/**
 * Returns a redacted view safe to send back to the client UI.
 * Reveals which fields are set without exposing secrets.
 */
export function describePodcastStorage(podcastId: number): {
  adapter: StorageAdapter
  configured: boolean
  fields: Record<string, string | boolean | number>
} {
  const storage = loadPodcastStorage(podcastId)
  if (!storage) return { adapter: 'sftp', configured: false, fields: {} }

  if (!storage.sftp && !storage.s3) {
    return { adapter: storage.adapter, configured: false, fields: {} }
  }

  if (storage.adapter === 'sftp' && storage.sftp) {
    const c = storage.sftp
    return {
      adapter: 'sftp',
      configured: true,
      fields: {
        host: c.host,
        port: c.port ?? 22,
        username: c.username,
        remoteDir: c.remoteDir,
        publicUrlBase: c.publicUrlBase,
        hasPrivateKey: !!c.privateKey,
        hasPassphrase: !!c.passphrase,
        hasPassword: !!c.password,
      },
    }
  }

  if (storage.adapter === 's3' && storage.s3) {
    const c = storage.s3
    return {
      adapter: 's3',
      configured: true,
      fields: {
        endpoint: c.endpoint || '',
        region: c.region,
        bucketName: c.bucketName,
        publicUrlBase: c.publicUrlBase,
        accessKeyId: c.accessKeyId.slice(0, 6) + '…',
        hasSecret: !!c.secretAccessKey,
      },
    }
  }

  return { adapter: storage.adapter, configured: false, fields: {} }
}
