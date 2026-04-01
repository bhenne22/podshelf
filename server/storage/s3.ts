import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

let _s3Client: S3Client | null = null

function getS3Client(): S3Client {
  if (_s3Client) return _s3Client

  const region = process.env.S3_REGION || 'us-east-1'
  const accessKeyId = process.env.S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY
  const endpoint = process.env.S3_ENDPOINT

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('S3 credentials incomplete. Required: S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY')
  }

  const config: ConstructorParameters<typeof S3Client>[0] = {
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  }

  // Support Backblaze B2 and other S3-compatible endpoints
  if (endpoint) {
    config.endpoint = endpoint
    config.forcePathStyle = true
  }

  _s3Client = new S3Client(config)
  return _s3Client
}

/**
 * Upload a file buffer to S3 (or S3-compatible storage like Backblaze B2).
 * Returns the public URL of the uploaded file.
 */
export async function uploadToS3(
  buffer: Buffer,
  filename: string,
  contentType: string = 'application/octet-stream'
): Promise<string> {
  const bucketName = process.env.S3_BUCKET_NAME
  const publicUrlBase = process.env.S3_PUBLIC_URL_BASE

  if (!bucketName || !publicUrlBase) {
    throw new Error(
      'S3 configuration incomplete. Required: S3_BUCKET_NAME, S3_PUBLIC_URL_BASE'
    )
  }

  const client = getS3Client()

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: filename,
    Body: buffer,
    ContentType: contentType,
    // Make publicly readable
    ACL: 'public-read',
  })

  await client.send(command)

  const publicUrl = `${publicUrlBase.replace(/\/$/, '')}/${filename}`
  return publicUrl
}
