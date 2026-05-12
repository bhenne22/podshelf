import busboy from 'busboy'
import { createError, type H3Event } from 'h3'

export interface FileStreamPart {
  filename: string
  contentType: string
  /**
   * The file body as a Readable. Busboy sets `truncated = true` when the
   * upload exceeds the configured fileSize limit; callers must check this
   * AFTER consuming the stream and clean up any partial artifact.
   */
  stream: NodeJS.ReadableStream & { truncated?: boolean }
}

/**
 * Streams the first multipart "file" field of the request body to the caller's
 * handler without buffering the body in memory. The handler is invoked exactly
 * once with a Readable; it MUST consume the stream (pipe it somewhere) before
 * returning, or busboy will stall and the request will hang.
 *
 * Use this instead of h3's readMultipartFormData for endpoints that accept
 * large uploads (audio, etc) — readMultipartFormData buffers the entire body,
 * which OOMs on small VMs.
 */
export async function streamFilePart<T>(
  event: H3Event,
  options: {
    fieldName?: string
    maxSize: number
    onFile: (part: FileStreamPart) => Promise<T>
  },
): Promise<T> {
  const req = event.node.req
  const headers = req.headers
  const ct = headers['content-type']
  if (!ct || !ct.toLowerCase().includes('multipart/form-data')) {
    throw createError({ statusCode: 400, statusMessage: 'Expected multipart/form-data' })
  }
  const fieldName = options.fieldName ?? 'file'

  return await new Promise<T>((resolve, reject) => {
    let bb: ReturnType<typeof busboy>
    try {
      bb = busboy({
        headers: headers as Record<string, string>,
        limits: { files: 1, fileSize: options.maxSize },
      })
    } catch (err) {
      reject(err)
      return
    }

    let handlerResult: Promise<T> | null = null
    let fileSeen = false

    bb.on('file', (name, file, info) => {
      if (name !== fieldName || fileSeen) {
        file.resume()
        return
      }
      fileSeen = true
      const filename = info.filename || ''
      const contentType = info.mimeType || 'application/octet-stream'

      handlerResult = options.onFile({
        filename,
        contentType,
        stream: file as NodeJS.ReadableStream & { truncated?: boolean },
      })
      // Swallow rejections here so they don't become unhandled — the 'close'
      // handler awaits handlerResult and will surface the error.
      handlerResult.catch(() => {
        try { file.resume() } catch { /* already drained */ }
      })
    })

    bb.on('error', (err) => reject(err))
    bb.on('close', async () => {
      if (!fileSeen) {
        reject(createError({ statusCode: 400, statusMessage: `Form field "${fieldName}" not found` }))
        return
      }
      if (!handlerResult) {
        reject(new Error('Internal: upload handler did not run'))
        return
      }
      try {
        resolve(await handlerResult)
      } catch (err) {
        reject(err)
      }
    })

    req.on('aborted', () => {
      reject(createError({ statusCode: 400, statusMessage: 'Client aborted upload' }))
    })

    req.pipe(bb)
  })
}
