import { defineEventHandler, getRouterParam, getQuery, createError } from 'h3'
import { Transform } from 'stream'
import { requirePodcastAccess } from '../../../utils/auth'
import { loadPodcastStorage } from '../../../utils/storage-config'
import { isMigrationActive } from '../../../utils/storage-migration'
import { uploadStreamToSftp, deleteFromSftp } from '../../../storage/sftp'
import { uploadStreamToS3, deleteFromS3 } from '../../../storage/s3'
import { streamFilePart } from '../../../utils/multipart-stream'

const AUDIO_TYPES = [
  'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/x-m4a',
  'audio/aac', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/flac',
]
const IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']

// Browsers report wildly inconsistent MIMEs for transcript files: .srt is often
// 'application/octet-stream', .vtt sometimes 'text/plain'. Accept the common
// content-type set + fall back to extension matching for the rest.
const TRANSCRIPT_TYPES = [
  'text/html', 'text/plain', 'text/vtt',
  'application/srt', 'application/x-subrip',
  'application/json',
  'application/octet-stream',
]
const TRANSCRIPT_EXTENSIONS = ['html', 'htm', 'txt', 'srt', 'vtt', 'json']

const CHAPTERS_TYPES = ['application/json', 'application/octet-stream']
const CHAPTERS_EXTENSIONS = ['json']

const MAX_SIZE_AUDIO = 500 * 1024 * 1024
const MAX_SIZE_IMAGE = 25 * 1024 * 1024
const MAX_SIZE_TEXT = 10 * 1024 * 1024
const MAX_SIZE_CHAPTERS = 2 * 1024 * 1024

type UploadKind = 'audio' | 'artwork' | 'transcript' | 'chapters'

function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : ''
}

/**
 * POST /api/podcasts/[slug]/upload?kind=audio|artwork|transcript|chapters
 *
 * Streams a multipart upload directly into the podcast's storage adapter
 * without buffering the body in memory. Storage credentials are loaded
 * from the encrypted per-podcast config.
 *
 * Transcript and chapters files land in the same directory as audio
 * (sidecar files next to the MP3) — Podshelf doesn't host listener-facing
 * content, so all per-episode artifacts live with the episode audio.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)

  const query = getQuery(event)
  const rawKind = String(query.kind || 'audio')
  const kind: UploadKind = (
    rawKind === 'artwork' || rawKind === 'transcript' || rawKind === 'chapters'
  ) ? rawKind : 'audio'
  // Physical storage directory: artwork → artwork dir, everything else → audio dir.
  const storageKind: 'audio' | 'artwork' = kind === 'artwork' ? 'artwork' : 'audio'

  if (isMigrationActive(podcastId)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'A storage migration is in progress for this podcast. Wait until it finishes before uploading new files.',
    })
  }

  const storage = loadPodcastStorage(podcastId)
  if (!storage || (!storage.sftp && !storage.s3)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Storage is not configured for this podcast. Set it up in Settings → Storage.',
    })
  }

  if (kind === 'artwork') {
    if (storage.adapter === 'sftp' && (!storage.sftp?.artworkRemoteDir || !storage.sftp?.artworkPublicUrlBase)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Artwork directory is not configured. Set artwork remote directory and public URL base in Storage settings.',
      })
    }
    if (storage.adapter === 's3' && !storage.s3?.artworkPublicUrlBase && !storage.s3?.artworkPrefix) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Artwork S3 settings are not configured. Set artwork prefix and/or public URL base in Storage settings.',
      })
    }
  }

  const maxSize =
    kind === 'artwork' ? MAX_SIZE_IMAGE :
    kind === 'transcript' ? MAX_SIZE_TEXT :
    kind === 'chapters' ? MAX_SIZE_CHAPTERS :
    MAX_SIZE_AUDIO

  // `aborted` is deprecated in newer Node but still set on an interrupted
  // request; `destroyed` covers the rest. Either way the client is gone.
  const isRequestAborted = () =>
    event.node.req.destroyed === true
    || (event.node.req as { aborted?: boolean }).aborted === true

  return await streamFilePart(event, {
    maxSize,
    onFile: async ({ filename: rawFilename, contentType, stream }) => {
      const incomingName = rawFilename || `upload-${Date.now()}`
      const ext = extOf(incomingName)
      const acceptedByMime =
        kind === 'artwork' ? IMAGE_TYPES.includes(contentType) :
        kind === 'transcript' ? TRANSCRIPT_TYPES.includes(contentType) :
        kind === 'chapters' ? CHAPTERS_TYPES.includes(contentType) :
        AUDIO_TYPES.includes(contentType)
      const acceptedByExt =
        kind === 'transcript' ? TRANSCRIPT_EXTENSIONS.includes(ext) :
        kind === 'chapters' ? CHAPTERS_EXTENSIONS.includes(ext) :
        false

      if (!acceptedByMime && !acceptedByExt) {
        const friendly =
          kind === 'artwork' ? 'image (JPEG, PNG, or WebP)' :
          kind === 'transcript' ? 'transcript (HTML, TXT, SRT, VTT, or JSON)' :
          kind === 'chapters' ? 'chapters JSON' :
          'audio'
        // Drain so busboy can finish parsing the request body.
        stream.resume()
        throw createError({
          statusCode: 400,
          statusMessage: `Invalid file type "${contentType}". Expected a ${friendly} file.`,
        })
      }

      const basename = incomingName.split(/[/\\]/).pop() || `upload-${Date.now()}`
      const filename = basename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 255)

      // Browsers often send 'application/octet-stream' for SRT/VTT files;
      // map ext → standard type so the response carries something usable
      // by the client form (e.g. transcript_type).
      let storedContentType = contentType
      if (kind === 'transcript' && contentType === 'application/octet-stream') {
        if (ext === 'srt') storedContentType = 'application/srt'
        else if (ext === 'vtt') storedContentType = 'text/vtt'
        else if (ext === 'json') storedContentType = 'application/json'
        else if (ext === 'html' || ext === 'htm') storedContentType = 'text/html'
        else if (ext === 'txt') storedContentType = 'text/plain'
      }
      if (kind === 'chapters') storedContentType = 'application/json+chapters'

      let bytesSeen = 0
      const counter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          bytesSeen += chunk.length
          cb(null, chunk)
        },
      })
      stream.pipe(counter)
      // If the source errors (busboy abort, client disconnect), tear down
      // the counter so the storage upload stops too.
      stream.on('error', (err) => counter.destroy(err))

      // Whatever bytes already reached storage sit there under the *real*
      // filename, so a half-finished upload leaves a truncated file that still
      // parses and plays — indistinguishable from a good one until someone
      // notices the episode stops early. Every failure path has to bin it.
      // An arrow const, not a hoisted `function` — a declaration is visible
      // before the null guard above, so TS drops the narrowing on `storage`.
      const discardPartial = async () => {
        try {
          if (storage.adapter === 's3' && storage.s3) {
            await deleteFromS3(storage.s3, storageKind, filename)
          } else if (storage.adapter === 'sftp' && storage.sftp) {
            await deleteFromSftp(storage.sftp, storageKind, filename)
          }
        } catch { /* best-effort cleanup */ }
      }

      let url: string
      try {
        if (storage.adapter === 's3' && storage.s3) {
          url = await uploadStreamToS3(counter, filename, storedContentType, storage.s3, storageKind)
        } else if (storage.adapter === 'sftp' && storage.sftp) {
          url = await uploadStreamToSftp(counter, filename, storage.sftp, storageKind)
        } else {
          throw createError({ statusCode: 500, statusMessage: 'Storage configuration mismatch' })
        }
      } catch (err: unknown) {
        // Reached on a client disconnect mid-transfer as well as on a storage
        // failure: streamFilePart destroys busboy on abort, which errors the
        // file stream, which tears down the counter and rejects the upload.
        await discardPartial()
        throw createError({
          statusCode: 500,
          statusMessage: err instanceof Error ? err.message : 'Upload failed',
        })
      }

      // Busboy sets `truncated` on the source stream when the fileSize limit
      // is exceeded; the storage upload still completes (with a partial file),
      // so we delete the partial artifact and surface a 413.
      if (stream.truncated) {
        await discardPartial()
        const mb = Math.round(maxSize / (1024 * 1024))
        throw createError({ statusCode: 413, statusMessage: `File too large. Maximum size is ${mb} MB.` })
      }

      // A disconnect can also land here: busboy may end the file stream cleanly
      // on a premature request end, in which case the storage write "succeeds"
      // with short content and nothing above fires. Trust the request, not the
      // stream — if the client is gone, the object is incomplete by definition.
      if (isRequestAborted()) {
        await discardPartial()
        throw createError({ statusCode: 400, statusMessage: 'Client aborted upload' })
      }

      return { url, filename, size: bytesSeen, content_type: storedContentType, kind }
    },
  })
})
