import SftpClient from 'ssh2-sftp-client'
import { readFileSync, existsSync } from 'fs'
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

  const resolvedKeyPath = resolve(privateKeyPath)
  if (!existsSync(resolvedKeyPath)) {
    throw new Error(`SFTP private key not found at: ${resolvedKeyPath}`)
  }

  const privateKey = readFileSync(resolvedKeyPath)
  const sftp = new SftpClient()

  try {
    await sftp.connect({ host, port, username, privateKey })

    try {
      await sftp.mkdir(remoteDir, true)
    } catch (err) {
      throw new Error(`Failed to create remote directory "${remoteDir}": ${err instanceof Error ? err.message : err}`)
    }

    const remotePath = `${remoteDir}/${filename}`
    const stream = Readable.from(buffer)

    try {
      await sftp.put(stream, remotePath)
    } catch (err) {
      throw new Error(`Failed to upload "${filename}" to SFTP: ${err instanceof Error ? err.message : err}`)
    }

    const publicUrl = `${publicUrlBase.replace(/\/$/, '')}/${filename}`
    return publicUrl
  } finally {
    await sftp.end()
  }
}
