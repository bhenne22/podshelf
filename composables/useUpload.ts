type UploadKind = 'audio' | 'artwork' | 'transcript' | 'chapters'

interface UploadResult {
  url: string
  filename: string
  size: number
  content_type?: string
  kind?: UploadKind
}

/**
 * Turn a failed upload into something the user can act on.
 *
 * Podshelf's own errors are JSON and already carry a real explanation, so
 * prefer those. Anything else came from a proxy in front of the app — notably
 * Cloudflare, which caps request bodies at 100 MB and answers with an HTML 413
 * the app never sees at all.
 *
 * The old `xhr.statusText || 'Upload failed'` collapsed every one of these to
 * the bare string: HTTP/2 carries no reason phrase, so statusText is '' for
 * exactly the proxy responses worth explaining, and an oversized episode
 * looked identical to a generic failure.
 */
function describeFailure(xhr: XMLHttpRequest): string {
  try {
    const body = JSON.parse(xhr.responseText) as { statusMessage?: string; message?: string }
    const msg = body.statusMessage || body.message
    if (msg) return msg
  } catch {
    // Not JSON — a proxy error page. Fall through to the status-based text.
  }

  if (xhr.status === 413) {
    return 'File too large — rejected before it reached Podshelf, most likely by the 100 MB Cloudflare upload limit.'
  }
  return xhr.statusText || `Upload failed (HTTP ${xhr.status || 'no response'})`
}

export function useUpload(podcastSlug: string) {
  const uploading = ref(false)
  const uploadProgress = ref(0)

  function uploadFile(file: File, kind: UploadKind = 'audio'): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
      const formData = new FormData()
      formData.append('file', file)

      const xhr = new XMLHttpRequest()
      xhr.open('POST', `/api/podcasts/${podcastSlug}/upload?kind=${kind}`)

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          uploadProgress.value = Math.round((e.loaded / e.total) * 100)
        }
      }

      xhr.onload = () => {
        uploading.value = false
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText))
          } catch {
            reject(new Error('Invalid response from server'))
          }
        } else {
          reject(new Error(describeFailure(xhr)))
        }
      }

      xhr.onerror = () => {
        uploading.value = false
        reject(new Error('Upload failed'))
      }

      uploading.value = true
      uploadProgress.value = 0
      xhr.send(formData)
    })
  }

  return { uploading, uploadProgress, uploadFile }
}
