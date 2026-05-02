import SftpClient from 'ssh2-sftp-client'
import { Readable } from 'stream'
import type { SftpConfig } from '../utils/storage-config'

/**
 * Normalizes a pasted private key for ssh2:
 *  - converts CRLF -> LF (Windows clipboard, certain editors)
 *  - strips leading/trailing whitespace, then re-adds a trailing newline
 *    (some parsers require the final LF after the END marker).
 */
function normalizeKey(key: string): string {
  return key.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim() + '\n'
}

export interface SftpListEntry {
  name: string
  type: 'file' | 'dir' | 'link' | 'other'
  size: number
  modifiedAt: number | null
}

export interface SftpTestResult {
  ok: boolean
  remoteDir: string
  totalEntries: number
  entries: SftpListEntry[]
}

/**
 * Connects via SFTP, lists the configured remote directory, and returns
 * the first N entries — used to validate credentials and that the user
 * pointed remoteDir at the right place.
 */
export async function testSftpConnection(config: SftpConfig, limit = 10): Promise<SftpTestResult> {
  const { host, port = 22, username, privateKey, passphrase, password, remoteDir } = config

  if (!host || !username || !remoteDir) {
    throw new Error('SFTP test requires host, username, and remoteDir')
  }
  if (!privateKey && !password) {
    throw new Error('SFTP test requires privateKey or password')
  }

  const sftp = new SftpClient()
  try {
    await sftp.connect({
      host,
      port,
      username,
      ...(privateKey ? { privateKey: normalizeKey(privateKey) } : {}),
      ...(privateKey && passphrase ? { passphrase } : {}),
      ...(password ? { password } : {}),
    })

    const exists = await sftp.exists(remoteDir)
    if (!exists) {
      throw new Error(`Remote directory does not exist: ${remoteDir}`)
    }

    const raw = await sftp.list(remoteDir)
    const entries: SftpListEntry[] = raw.slice(0, limit).map((e) => ({
      name: e.name,
      type: e.type === 'd' ? 'dir' : e.type === '-' ? 'file' : e.type === 'l' ? 'link' : 'other',
      size: e.size,
      modifiedAt: typeof e.modifyTime === 'number' ? e.modifyTime : null,
    }))

    return {
      ok: true,
      remoteDir,
      totalEntries: raw.length,
      entries,
    }
  } finally {
    await sftp.end()
  }
}

/**
 * Upload a file buffer to a remote server via SFTP.
 * Returns the public URL of the uploaded file.
 */
export async function uploadToSftp(
  buffer: Buffer,
  filename: string,
  config: SftpConfig,
): Promise<string> {
  const { host, port = 22, username, privateKey, passphrase, password, remoteDir, publicUrlBase } = config

  if (!host || !username || !remoteDir || !publicUrlBase) {
    throw new Error('SFTP configuration incomplete: host, username, remoteDir, publicUrlBase are required')
  }
  if (!privateKey && !password) {
    throw new Error('SFTP configuration requires either privateKey or password')
  }

  const sftp = new SftpClient()

  try {
    await sftp.connect({
      host,
      port,
      username,
      ...(privateKey ? { privateKey: normalizeKey(privateKey) } : {}),
      ...(privateKey && passphrase ? { passphrase } : {}),
      ...(password ? { password } : {}),
    })

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

    return `${publicUrlBase.replace(/\/$/, '')}/${filename}`
  } finally {
    await sftp.end()
  }
}
