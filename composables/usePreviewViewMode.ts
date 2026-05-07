/**
 * Shared state for the Desktop / Mobile view toggle on the preview pages.
 * Persists across navigation within a single tab via sessionStorage.
 */

const STORAGE_KEY = 'podshelf:preview-view-mode'

export type PreviewViewMode = 'desktop' | 'mobile'

const _mode = ref<PreviewViewMode>('desktop')
let _initialized = false

function readInitial(): PreviewViewMode {
  if (typeof window === 'undefined') return 'desktop'
  try {
    const v = sessionStorage.getItem(STORAGE_KEY)
    return v === 'mobile' ? 'mobile' : 'desktop'
  } catch {
    return 'desktop'
  }
}

export function usePreviewViewMode() {
  if (!_initialized && typeof window !== 'undefined') {
    _mode.value = readInitial()
    watch(_mode, (m) => {
      try { sessionStorage.setItem(STORAGE_KEY, m) } catch { /* private mode etc. */ }
    })
    _initialized = true
  }
  return _mode
}
