import getDb from '../db/index'
import {
  loadPodcastStorage,
  resolveSftpTarget,
  resolveS3Target,
  type PodcastStorage,
  type SftpConfig,
  type S3Config,
  type StorageKind,
} from './storage-config'
import { encryptJson, decryptJson } from './crypto'
import { listSftpDirectory, uploadToSftp, downloadFromSftp, statSftp } from '../storage/sftp'
import { listS3Directory, uploadToS3, downloadFromS3, statS3 } from '../storage/s3'
import { logAudit } from './audit'

interface MigrationRow {
  id: number
  podcast_id: number
  status: string
  source_adapter: string
  target_adapter: string
  target_config_encrypted: string
  files_total: number
  files_done: number
  files_failed: number
  bytes_total: number
  bytes_done: number
  current_file: string | null
  error_message: string | null
}

interface FilePlan {
  kind: StorageKind
  filename: string
  size: number
}

/**
 * Returns the most-recent migration row for this podcast, or null.
 */
export function getCurrentMigration(podcastId: number): MigrationRow | null {
  const db = getDb()
  return db.prepare(`
    SELECT * FROM storage_migrations WHERE podcast_id = ? ORDER BY id DESC LIMIT 1
  `).get(podcastId) as MigrationRow | null
}

export function isMigrationActive(podcastId: number): boolean {
  const current = getCurrentMigration(podcastId)
  return current ? current.status === 'pending' || current.status === 'running' : false
}

/**
 * Lists every file we need to copy, with sizes when available. Used both
 * to seed `files_total` / `bytes_total` and to walk during the actual run.
 */
async function planFiles(source: PodcastStorage): Promise<FilePlan[]> {
  const out: FilePlan[] = []
  if (source.adapter === 'sftp' && source.sftp) {
    for (const kind of ['audio', 'artwork'] as StorageKind[]) {
      try {
        const result = await listSftpDirectory(source.sftp, kind)
        for (const entry of result.entries) {
          if (entry.type === 'file') {
            out.push({ kind, filename: entry.name, size: entry.size })
          }
        }
      } catch (err) {
        // listSftpDirectory throws when the dir isn't configured (e.g. no
        // separate artwork dir). Treat that as "nothing to migrate for this
        // kind" — the audio dir always must be configured for a working
        // podcast, so audio errors will surface naturally on connect.
        if (kind === 'audio') throw err
      }
    }
  } else if (source.adapter === 's3' && source.s3) {
    for (const kind of ['audio', 'artwork'] as StorageKind[]) {
      try {
        const result = await listS3Directory(source.s3, kind)
        for (const entry of result.entries) {
          // Skip "directory" placeholder keys ending with '/'.
          if (!entry.key || entry.key.endsWith('/')) continue
          out.push({ kind, filename: entry.key, size: entry.size })
        }
      } catch (err) {
        if (kind === 'audio') throw err
      }
    }
  }
  return out
}

async function copyOneFile(
  source: PodcastStorage,
  target: PodcastStorage,
  plan: FilePlan,
): Promise<number> {
  // Skip when target already has it (idempotent retry).
  if (target.adapter === 'sftp' && target.sftp) {
    const existing = await statSftp(target.sftp, plan.kind, plan.filename)
    if (existing !== null && existing > 0) return existing
  } else if (target.adapter === 's3' && target.s3) {
    const existing = await statS3(target.s3, plan.kind, plan.filename)
    if (existing !== null && existing > 0) return existing
  }

  // Download from source.
  let buffer: Buffer
  if (source.adapter === 'sftp' && source.sftp) {
    buffer = await downloadFromSftp(source.sftp, plan.kind, plan.filename)
  } else if (source.adapter === 's3' && source.s3) {
    buffer = await downloadFromS3(source.s3, plan.kind, plan.filename)
  } else {
    throw new Error('Unknown source adapter')
  }

  // Upload to target.
  if (target.adapter === 'sftp' && target.sftp) {
    await uploadToSftp(buffer, plan.filename, target.sftp, plan.kind)
  } else if (target.adapter === 's3' && target.s3) {
    // Browsers/iTunes happy with audio/mpeg for unknown extensions of audio
    // files; for migration we don't try to be clever about MIME — the
    // existing files already had a content-type when first uploaded.
    await uploadToS3(buffer, plan.filename, 'application/octet-stream', target.s3, plan.kind)
  } else {
    throw new Error('Unknown target adapter')
  }

  return buffer.length
}

function publicUrlBaseFor(storage: PodcastStorage, kind: StorageKind): string | null {
  if (storage.adapter === 'sftp' && storage.sftp) {
    return resolveSftpTarget(storage.sftp, kind).publicUrlBase || null
  }
  if (storage.adapter === 's3' && storage.s3) {
    return resolveS3Target(storage.s3, kind).publicUrlBase || null
  }
  return null
}

/**
 * Replaces `oldBase` with `newBase` at the start of the value when present.
 * Trailing-slash handling: both are normalized to no-trailing-slash before
 * compare/replace so adapter quirks don't trip the match.
 */
function rewriteUrl(value: string | null, oldBase: string, newBase: string): string | null {
  if (!value) return value
  const norm = (s: string) => s.replace(/\/+$/, '')
  const o = norm(oldBase)
  const n = norm(newBase)
  if (!o || !n) return value
  if (value.startsWith(o + '/')) return n + value.slice(o.length)
  if (value === o) return n
  return value
}

/**
 * Walk every URL field on the podcast + episodes that points at one of the
 * source publicUrlBases and rewrite to the target base. Runs in a single
 * transaction so a half-rewrite is impossible.
 */
function rewriteUrlsAfterMigration(
  podcastId: number,
  source: PodcastStorage,
  target: PodcastStorage,
): { episodes_rewritten: number; podcast_image_rewritten: boolean } {
  const db = getDb()
  const audioOld = publicUrlBaseFor(source, 'audio')
  const audioNew = publicUrlBaseFor(target, 'audio')
  const artworkOld = publicUrlBaseFor(source, 'artwork')
  const artworkNew = publicUrlBaseFor(target, 'artwork')

  let podcastChanged = false
  let episodesChanged = 0

  db.transaction(() => {
    if (artworkOld && artworkNew) {
      const podcastRow = db.prepare('SELECT image_url FROM podcasts WHERE id = ?')
        .get(podcastId) as { image_url: string | null }
      const newImage = rewriteUrl(podcastRow.image_url, artworkOld, artworkNew)
      if (newImage !== podcastRow.image_url) {
        db.prepare("UPDATE podcasts SET image_url = ?, updated_at = datetime('now') WHERE id = ?")
          .run(newImage, podcastId)
        podcastChanged = true
      }
    }

    const episodes = db.prepare(`
      SELECT id, audio_url, image_url, transcript_path, chapters_url
      FROM episodes WHERE podcast_id = ?
    `).all(podcastId) as Array<{
      id: number
      audio_url: string | null
      image_url: string | null
      transcript_path: string | null
      chapters_url: string | null
    }>

    const update = db.prepare(`
      UPDATE episodes SET
        audio_url = @audio_url,
        image_url = @image_url,
        transcript_path = @transcript_path,
        chapters_url = @chapters_url,
        updated_at = datetime('now')
      WHERE id = @id
    `)

    for (const ep of episodes) {
      const audio = audioOld && audioNew ? rewriteUrl(ep.audio_url, audioOld, audioNew) : ep.audio_url
      const transcript = audioOld && audioNew ? rewriteUrl(ep.transcript_path, audioOld, audioNew) : ep.transcript_path
      const chapters = audioOld && audioNew ? rewriteUrl(ep.chapters_url, audioOld, audioNew) : ep.chapters_url
      const image = artworkOld && artworkNew ? rewriteUrl(ep.image_url, artworkOld, artworkNew) : ep.image_url
      if (audio !== ep.audio_url || transcript !== ep.transcript_path || chapters !== ep.chapters_url || image !== ep.image_url) {
        update.run({
          id: ep.id,
          audio_url: audio,
          image_url: image,
          transcript_path: transcript,
          chapters_url: chapters,
        })
        episodesChanged++
      }
    }
  })()

  return { episodes_rewritten: episodesChanged, podcast_image_rewritten: podcastChanged }
}

async function runMigration(row: MigrationRow): Promise<void> {
  const db = getDb()
  const source = loadPodcastStorage(row.podcast_id)
  if (!source || (!source.sftp && !source.s3)) {
    throw new Error('Source storage no longer configured')
  }
  const target = decryptJson<PodcastStorage>(row.target_config_encrypted)

  // Move into 'running' before any side effects so other workers / requests
  // can see we own this migration.
  db.prepare(`
    UPDATE storage_migrations SET status = 'running', started_at = datetime('now') WHERE id = ?
  `).run(row.id)

  const plan = await planFiles(source)
  const totalBytes = plan.reduce((sum, p) => sum + (p.size || 0), 0)
  db.prepare(`
    UPDATE storage_migrations SET files_total = ?, bytes_total = ? WHERE id = ?
  `).run(plan.length, totalBytes, row.id)

  let done = 0
  let failed = 0
  let bytesDone = 0
  for (const file of plan) {
    db.prepare("UPDATE storage_migrations SET current_file = ? WHERE id = ?")
      .run(`${file.kind}/${file.filename}`, row.id)
    try {
      const copied = await copyOneFile(source, target, file)
      bytesDone += copied
      done++
    } catch (err) {
      console.error('[storage-migration] file failed', { file, err })
      failed++
    }
    db.prepare(`
      UPDATE storage_migrations SET files_done = ?, files_failed = ?, bytes_done = ? WHERE id = ?
    `).run(done, failed, bytesDone, row.id)
  }

  if (failed > 0) {
    db.prepare(`
      UPDATE storage_migrations SET status = 'failed', current_file = NULL,
        error_message = ?, finished_at = datetime('now')
      WHERE id = ?
    `).run(`${failed} file(s) failed to transfer`, row.id)

    logAudit({
      podcastId: row.podcast_id,
      userId: null,
      action: 'storage.migrate.fail',
      entityType: 'podcast',
      entityId: row.podcast_id,
      summary: `Storage migration failed: ${failed} file(s) didn't copy`,
      details: { files_total: plan.length, files_done: done, files_failed: failed },
    })
    return
  }

  // All files copied — rewrite URLs + swap config in a single DB transaction.
  const rewriteResult = rewriteUrlsAfterMigration(row.podcast_id, source, target)

  const targetEncryptedConfig = target.adapter === 'sftp'
    ? encryptJson(target.sftp)
    : encryptJson(target.s3)

  db.prepare(`
    UPDATE podcasts SET storage_adapter = ?, storage_config_encrypted = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(target.adapter, targetEncryptedConfig, row.podcast_id)

  db.prepare(`
    UPDATE storage_migrations SET status = 'complete', current_file = NULL,
      finished_at = datetime('now')
    WHERE id = ?
  `).run(row.id)

  logAudit({
    podcastId: row.podcast_id,
    userId: null,
    action: 'storage.migrate.complete',
    entityType: 'podcast',
    entityId: row.podcast_id,
    summary: `Storage migration complete: ${done} file(s) copied, swapped to ${target.adapter}`,
    details: {
      from: row.source_adapter,
      to: row.target_adapter,
      files_done: done,
      bytes_done: bytesDone,
      ...rewriteResult,
    },
  })
}

let workerRunning = false
let timerHandle: ReturnType<typeof setInterval> | null = null

async function pickAndRun(): Promise<void> {
  if (workerRunning) return
  const db = getDb()
  const next = db.prepare(`
    SELECT * FROM storage_migrations WHERE status = 'pending' ORDER BY id LIMIT 1
  `).get() as MigrationRow | undefined
  if (!next) return
  workerRunning = true
  try {
    await runMigration(next)
  } catch (err) {
    console.error('[storage-migration] runMigration failed', err)
    db.prepare(`
      UPDATE storage_migrations SET status = 'failed',
        error_message = ?, finished_at = datetime('now')
      WHERE id = ? AND status IN ('pending', 'running')
    `).run(err instanceof Error ? err.message : String(err), next.id)
  } finally {
    workerRunning = false
  }
}

/**
 * Start the in-process migration worker. Picks one pending migration off
 * the queue at a time and runs it to completion. Stale 'running' rows
 * (from a previous process that died) are marked failed at startup.
 */
export function startMigrationWorker(intervalMs = 5000) {
  if (timerHandle) return

  // Reap stale 'running' migrations from a previous (now-dead) process.
  const db = getDb()
  db.prepare(`
    UPDATE storage_migrations SET status = 'failed',
      error_message = COALESCE(error_message, 'Server restarted during migration'),
      finished_at = datetime('now')
    WHERE status = 'running'
  `).run()

  // Kick off once immediately, then on the interval.
  void pickAndRun().catch((err) => console.error('[storage-migration] initial run', err))
  timerHandle = setInterval(() => {
    void pickAndRun().catch((err) => console.error('[storage-migration] tick', err))
  }, intervalMs)
  if (typeof timerHandle.unref === 'function') timerHandle.unref()
}

export function stopMigrationWorker() {
  if (timerHandle) {
    clearInterval(timerHandle)
    timerHandle = null
  }
}
