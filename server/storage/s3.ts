import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3'
import type { S3Config, StorageKind } from '../utils/storage-config'
import { resolveS3Target } from '../utils/storage-config'

export interface S3ListEntry {
  key: string
  size: number
  modifiedAt: string | null
}

export interface S3TestResult {
  ok: boolean
  bucket: string
  totalEntries: number
  entries: S3ListEntry[]
}

function buildClient(config: S3Config): S3Client {
  const clientConfig: ConstructorParameters<typeof S3Client>[0] = {
    region: config.region || 'us-east-1',
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  }
  if (config.endpoint) {
    clientConfig.endpoint = config.endpoint
    clientConfig.forcePathStyle = true
  }
  return new S3Client(clientConfig)
}

/**
 * Connects to S3 with the given credentials and lists the first N objects
 * in the bucket — used to validate credentials and bucket reachability.
 */
export async function testS3Connection(config: S3Config, limit = 10, kind: StorageKind = 'audio'): Promise<S3TestResult> {
  if (!config.accessKeyId || !config.secretAccessKey || !config.bucketName) {
    throw new Error('S3 test requires accessKeyId, secretAccessKey, and bucketName')
  }

  const { prefix } = resolveS3Target(config, kind)
  const client = buildClient(config)
  const result = await client.send(new ListObjectsV2Command({
    Bucket: config.bucketName,
    Prefix: prefix || undefined,
    MaxKeys: limit,
  }))

  const entries: S3ListEntry[] = (result.Contents || []).map((o) => ({
    key: o.Key || '',
    size: o.Size || 0,
    modifiedAt: o.LastModified ? o.LastModified.toISOString() : null,
  }))

  return {
    ok: true,
    bucket: config.bucketName,
    totalEntries: result.KeyCount || entries.length,
    entries,
  }
}

/**
 * Upload a file buffer to S3 (or S3-compatible storage like Backblaze B2).
 * Returns the public URL of the uploaded file.
 */
export async function uploadToS3(
  buffer: Buffer,
  filename: string,
  contentType: string,
  config: S3Config,
  kind: StorageKind = 'audio',
): Promise<string> {
  if (!config.accessKeyId || !config.secretAccessKey || !config.bucketName || !config.publicUrlBase) {
    throw new Error('S3 configuration incomplete: accessKeyId, secretAccessKey, bucketName, publicUrlBase are required')
  }

  const { prefix, publicUrlBase } = resolveS3Target(config, kind)
  const client = buildClient(config)

  await client.send(new PutObjectCommand({
    Bucket: config.bucketName,
    Key: prefix + filename,
    Body: buffer,
    ContentType: contentType,
    ACL: 'public-read',
  }))

  return `${publicUrlBase.replace(/\/$/, '')}/${filename}`
}

/**
 * List every object under the prefix for the given kind. Used by the file
 * browser; lists up to 1000 keys (single page — fine for podcast scale).
 */
export async function listS3Directory(config: S3Config, kind: StorageKind): Promise<{ bucket: string; prefix: string; publicUrlBase: string; entries: S3ListEntry[] }> {
  if (!config.accessKeyId || !config.secretAccessKey || !config.bucketName) {
    throw new Error('S3 configuration incomplete')
  }
  const { prefix, publicUrlBase } = resolveS3Target(config, kind)
  const client = buildClient(config)
  const result = await client.send(new ListObjectsV2Command({
    Bucket: config.bucketName,
    Prefix: prefix || undefined,
    MaxKeys: 1000,
  }))
  const entries: S3ListEntry[] = (result.Contents || []).map((o) => ({
    key: (o.Key || '').slice(prefix.length),
    size: o.Size || 0,
    modifiedAt: o.LastModified ? o.LastModified.toISOString() : null,
  }))
  return { bucket: config.bucketName, prefix, publicUrlBase, entries }
}

export async function deleteFromS3(config: S3Config, kind: StorageKind, filename: string): Promise<void> {
  const { prefix } = resolveS3Target(config, kind)
  const client = buildClient(config)
  await client.send(new DeleteObjectCommand({
    Bucket: config.bucketName,
    Key: prefix + filename,
  }))
}

export async function renameInS3(config: S3Config, kind: StorageKind, fromName: string, toName: string): Promise<string> {
  const { prefix, publicUrlBase } = resolveS3Target(config, kind)
  const client = buildClient(config)
  await client.send(new CopyObjectCommand({
    Bucket: config.bucketName,
    Key: prefix + toName,
    CopySource: `/${config.bucketName}/${prefix + fromName}`,
    ACL: 'public-read',
  }))
  await client.send(new DeleteObjectCommand({
    Bucket: config.bucketName,
    Key: prefix + fromName,
  }))
  return `${publicUrlBase.replace(/\/$/, '')}/${toName}`
}
