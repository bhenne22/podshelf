import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand, CopyObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import type { Readable } from 'stream'
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
 * Stream-upload variant used by the multipart upload endpoint. Routes through
 * @aws-sdk/lib-storage's Upload helper, which transparently switches to S3
 * multipart upload for large bodies — memory stays bounded by partSize
 * regardless of the file size.
 */
export async function uploadStreamToS3(
  stream: Readable,
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

  const upload = new Upload({
    client,
    params: {
      Bucket: config.bucketName,
      Key: prefix + filename,
      Body: stream,
      ContentType: contentType,
      ACL: 'public-read',
    },
    partSize: 8 * 1024 * 1024,
    queueSize: 4,
  })

  await upload.done()
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

/**
 * Download an object from the bucket and return its bytes as a Buffer.
 * Used by the storage migration worker.
 */
export async function downloadFromS3(config: S3Config, kind: StorageKind, filename: string): Promise<Buffer> {
  const { prefix } = resolveS3Target(config, kind)
  const client = buildClient(config)
  const result = await client.send(new GetObjectCommand({
    Bucket: config.bucketName,
    Key: prefix + filename,
  }))
  // SDK v3: Body is a stream-like with transformToByteArray helper in Node.
  const body = result.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined
  if (!body || !body.transformToByteArray) {
    throw new Error(`S3 GetObject returned an unreadable body for ${filename}`)
  }
  const bytes = await body.transformToByteArray()
  return Buffer.from(bytes)
}

/**
 * Probe whether an object exists at the given key. Returns size on hit,
 * null on miss. Used to skip already-uploaded files on retry.
 */
export async function statS3(config: S3Config, kind: StorageKind, filename: string): Promise<number | null> {
  const { prefix } = resolveS3Target(config, kind)
  const client = buildClient(config)
  try {
    const info = await client.send(new HeadObjectCommand({
      Bucket: config.bucketName,
      Key: prefix + filename,
    }))
    return info.ContentLength ?? null
  } catch (err: unknown) {
    // 404 → not found; anything else propagates so we don't silently skip.
    if (err && typeof err === 'object' && '$metadata' in err) {
      const meta = (err as { $metadata?: { httpStatusCode?: number } }).$metadata
      if (meta?.httpStatusCode === 404) return null
    }
    throw err
  }
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
