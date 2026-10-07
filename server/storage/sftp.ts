import SftpClient from 'ssh2-sftp-client'
import { Readable } from 'stream'
import type { SftpConfig, StorageKind } from '../utils/storage-config'
import { resolveSftpTarget } from '../utils/storage-config'
import { writeStreamPipelined } from './sftp-stream-writer'

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
export async function testSftpConnection(config: SftpConfig, limit = 10, kind: StorageKind = 'audio'): Promise<SftpTestResult> {
  const { host, port = 22, username, privateKey, passphrase, password } = config
  const { remoteDir } = resolveSftpTarget(config, kind)

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
 * Upload a file buffer to a remote server via SFTP. Picks the audio or
 * artwork directory based on kind. Returns the public URL of the file.
 */
export async function uploadToSftp(
  buffer: Buffer,
  filename: string,
  config: SftpConfig,
  kind: StorageKind = 'audio',
): Promise<string> {
  return uploadStreamToSftp(Readable.from(buffer), filename, config, kind)
}

/**
 * Stream-upload variant. Used by the multipart upload endpoint so large MP3s
 * never get buffered in memory. Same return contract as uploadToSftp.
 *
 * Bytes land under `<filename>.partial` and are renamed into place only once
 * the whole file is written, so the file browser never shows a half-uploaded
 * episode under its real name, and a failed re-upload leaves the previous
 * copy untouched. `beforeCommit` runs between the two and may throw to abort —
 * the caller's chance to reject a truncated or abandoned upload before it
 * replaces anything. Its error is rethrown as-is; the partial is always
 * removed on failure.
 */
export async function uploadStreamToSftp(
  stream: Readable,
  filename: string,
  config: SftpConfig,
  kind: StorageKind = 'audio',
  options: { beforeCommit?: () => void } = {},
): Promise<string> {
  const { host, port = 22, username, privateKey, passphrase, password } = config
  const { remoteDir, publicUrlBase } = resolveSftpTarget(config, kind)

  if (!host || !username || !remoteDir || !publicUrlBase) {
    throw new Error(`SFTP ${kind} configuration incomplete: host, username, remoteDir, publicUrlBase are required`)
  }
  if (!privateKey && !password) {
    throw new Error('SFTP configuration requires either privateKey or password')
  }

  const sftp = new SftpClient()

  try {
    const wrapper = await sftp.connect({
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
    const partialPath = `${remotePath}.partial`

    try {
      try {
        // Arrow wrappers, not `wrapper` itself: SFTPWrapper.open's overloads
        // don't structurally match the narrow interface.
        await writeStreamPipelined({
          open: (path, flags, cb) => wrapper.open(path, flags, cb),
          write: (handle, buf, off, len, pos, cb) => wrapper.write(handle, buf, off, len, pos, cb),
          close: (handle, cb) => wrapper.close(handle, cb),
        }, stream, partialPath)
      } catch (err) {
        throw new Error(`Failed to upload "${filename}" to SFTP: ${err instanceof Error ? err.message : err}`)
      }
      options.beforeCommit?.()
      try {
        await replaceRemoteFile(sftp, partialPath, remotePath)
      } catch (err) {
        throw new Error(`Uploaded "${filename}" but could not move it into place: ${err instanceof Error ? err.message : err}`)
      }
    } catch (err) {
      try { await sftp.delete(partialPath, true) } catch { /* best-effort cleanup */ }
      throw err
    }

    return `${publicUrlBase.replace(/\/$/, '')}/${filename}`
  } finally {
    await sftp.end()
  }
}

/**
 * Rename that overwrites, matching what the old in-place `put` did on a
 * re-upload. Plain SFTP rename refuses an existing target, so prefer
 * OpenSSH's posix-rename (atomic — the old file stays servable until the
 * swap); fall back to delete-then-rename on servers without it.
 */
async function replaceRemoteFile(sftp: SftpClient, from: string, to: string): Promise<void> {
  try {
    await sftp.posixRename(from, to)
    return
  } catch { /* extension unsupported — fall through */ }
  if (await sftp.exists(to)) await sftp.delete(to)
  await sftp.rename(from, to)
}

/**
 * Lists every entry in the configured directory for a given kind.
 * Used by the file browser; no limit applied.
 */
export async function listSftpDirectory(config: SftpConfig, kind: StorageKind): Promise<{ remoteDir: string; publicUrlBase: string; entries: SftpListEntry[] }> {
  const { host, port = 22, username, privateKey, passphrase, password } = config
  const { remoteDir, publicUrlBase } = resolveSftpTarget(config, kind)

  if (!host || !username || !remoteDir) {
    throw new Error(`SFTP ${kind} directory not configured`)
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

    const exists = await sftp.exists(remoteDir)
    if (!exists) {
      return { remoteDir, publicUrlBase, entries: [] }
    }

    const raw = await sftp.list(remoteDir)
    const entries: SftpListEntry[] = raw.map((e) => ({
      name: e.name,
      type: e.type === 'd' ? 'dir' : e.type === '-' ? 'file' : e.type === 'l' ? 'link' : 'other',
      size: e.size,
      modifiedAt: typeof e.modifyTime === 'number' ? e.modifyTime : null,
    }))

    return { remoteDir, publicUrlBase, entries }
  } finally {
    await sftp.end()
  }
}

export async function deleteFromSftp(config: SftpConfig, kind: StorageKind, filename: string): Promise<void> {
  const { host, port = 22, username, privateKey, passphrase, password } = config
  const { remoteDir } = resolveSftpTarget(config, kind)
  if (!host || !username || !remoteDir) {
    throw new Error(`SFTP ${kind} directory not configured`)
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
    await sftp.delete(`${remoteDir}/${filename}`)
  } finally {
    await sftp.end()
  }
}

/**
 * Download a file's contents from the configured remote dir for `kind`.
 * Returns the bytes as a Buffer. Used by the storage migration worker.
 */
export async function downloadFromSftp(config: SftpConfig, kind: StorageKind, filename: string): Promise<Buffer> {
  const { host, port = 22, username, privateKey, passphrase, password } = config
  const { remoteDir } = resolveSftpTarget(config, kind)
  if (!host || !username || !remoteDir) {
    throw new Error(`SFTP ${kind} directory not configured`)
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
    // ssh2-sftp-client.get with no destination returns a Buffer.
    const result = await sftp.get(`${remoteDir}/${filename}`) as Buffer
    return result
  } finally {
    await sftp.end()
  }
}

/**
 * Probe whether a file already exists in the target dir (for kind). Returns
 * the file's size on hit, null on miss. Used by the migration worker to
 * skip already-uploaded files when retrying a failed migration.
 */
export async function statSftp(config: SftpConfig, kind: StorageKind, filename: string): Promise<number | null> {
  const { host, port = 22, username, privateKey, passphrase, password } = config
  const { remoteDir } = resolveSftpTarget(config, kind)
  if (!host || !username || !remoteDir) return null
  if (!privateKey && !password) return null

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
      const info = await sftp.stat(`${remoteDir}/${filename}`)
      return info?.size ?? null
    } catch {
      return null
    }
  } finally {
    await sftp.end()
  }
}

export async function renameInSftp(config: SftpConfig, kind: StorageKind, fromName: string, toName: string): Promise<string> {
  const { host, port = 22, username, privateKey, passphrase, password } = config
  const { remoteDir, publicUrlBase } = resolveSftpTarget(config, kind)
  if (!host || !username || !remoteDir || !publicUrlBase) {
    throw new Error(`SFTP ${kind} directory not configured`)
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
    await sftp.rename(`${remoteDir}/${fromName}`, `${remoteDir}/${toName}`)
    return `${publicUrlBase.replace(/\/$/, '')}/${toName}`
  } finally {
    await sftp.end()
  }
}
