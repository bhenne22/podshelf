import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import type { S3Config } from '../utils/storage-config'

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
export async function testS3Connection(config: S3Config, limit = 10): Promise<S3TestResult> {
  if (!config.accessKeyId || !config.secretAccessKey || !config.bucketName) {
    throw new Error('S3 test requires accessKeyId, secretAccessKey, and bucketName')
  }

  const client = buildClient(config)
  const result = await client.send(new ListObjectsV2Command({
    Bucket: config.bucketName,
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
): Promise<string> {
  if (!config.accessKeyId || !config.secretAccessKey || !config.bucketName || !config.publicUrlBase) {
    throw new Error('S3 configuration incomplete: accessKeyId, secretAccessKey, bucketName, publicUrlBase are required')
  }

  const client = buildClient(config)

  await client.send(new PutObjectCommand({
    Bucket: config.bucketName,
    Key: filename,
    Body: buffer,
    ContentType: contentType,
    ACL: 'public-read',
  }))

  return `${config.publicUrlBase.replace(/\/$/, '')}/${filename}`
}
