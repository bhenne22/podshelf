interface UploadResult {
  url: string
  filename: string
  size: number
}

export function useUpload(podcastSlug: string) {
  const uploading = ref(false)
  const uploadProgress = ref(0)

  function uploadFile(file: File): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
      const formData = new FormData()
      formData.append('file', file)

      const xhr = new XMLHttpRequest()
      xhr.open('POST', `/api/podcasts/${podcastSlug}/upload`)

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
          reject(new Error(xhr.statusText || 'Upload failed'))
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
