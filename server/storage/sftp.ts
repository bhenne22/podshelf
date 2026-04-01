import SftpClient from 'ssh2-sftp-client'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { Readable } from 'stream'

/**
 * Upload a file buffer to a remote server via SFTP.
 * Returns the public URL of the uploaded file.
 */
export async function uploadToSftp(buffer: Buffer, filename: string): Promise<string> {
  const host = process.env.SFTP_HOST
  const port = parseInt(process.env.SFTP_PORT || '22', 10)
  const username = process.env.SFTP_USER
  const privateKeyPath = process.env.SFTP_PRIVATE_KEY_PATH
  const remoteDir = process.env.SFTP_REMOTE_DIR
  const publicUrlBase = process.env.SFTP_PUBLIC_URL_BASE

  if (!host || !username || !privateKeyPath || !remoteDir || !publicUrlBase) {
    throw new Error(
      'SFTP configuration incomplete. Required: SFTP_HOST, SFTP_USER, ' +
      'SFTP_PRIVATE_KEY_PATH, SFTP_REMOTE_DIR, SFTP_PUBLIC_URL_BASE'
    )
  }

  const privateKey = readFileSync(resolve(privateKeyPath))

  const sftp = new SftpClient()

  try {
    await sftp.connect({
      host,
      port,
      username,
      privateKey,
    })

    // Ensure the remote directory exists
    await sftp.mkdir(remoteDir, true)

    const remotePath = `${remoteDir}/${filename}`

    // Convert Buffer to Readable stream for sftp.put
    const stream = Readable.from(buffer)
    await sftp.put(stream, remotePath)

    const publicUrl = `${publicUrlBase.replace(/\/$/, '')}/${filename}`
    return publicUrl
  } finally {
    await sftp.end()
  }
}
