<template>
  <div class="admin-page">
    <AdminNav :podcast-slug="podcastSlug" />
    <div class="container">
      <h1>Files</h1>
      <p class="hint">Browse, upload, rename, and delete files in this podcast's configured storage.</p>

      <div class="tabs">
        <button :class="['tab', { active: kind === 'audio' }]" @click="setKind('audio')">Audio</button>
        <button :class="['tab', { active: kind === 'artwork' }]" @click="setKind('artwork')">Artwork</button>
        <button class="refresh-btn" :disabled="loading" @click="reload">{{ loading ? 'Loading…' : 'Refresh' }}</button>
      </div>

      <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>
      <div v-if="successMsg" class="success-msg">{{ successMsg }}</div>

      <div class="upload-row">
        <label class="btn-upload">
          {{ uploading ? `Uploading… ${uploadProgress}%` : `Upload to ${kind} dir` }}
          <input type="file"
            :accept="kind === 'audio' ? 'audio/*' : 'image/jpeg,image/png,image/webp'"
            :disabled="uploading"
            @change="handleUpload"
            hidden
          />
        </label>
        <span v-if="data" class="dir-info">
          Public URL base: <code>{{ data.publicUrlBase }}</code>
        </span>
      </div>

      <div v-if="loading && !data" class="loading">Loading files…</div>

      <div v-else-if="!data || !data.files.length" class="empty">
        <p>No files in this directory yet.</p>
      </div>

      <template v-else>
        <div class="filter-bar">
          <div class="filter-group filter-search">
            <label>Search</label>
            <input
              type="search"
              v-model="searchInput"
              placeholder="Filename…"
              autocomplete="off"
            />
          </div>

          <div class="filter-group">
            <label>Status</label>
            <select v-model="statusFilter">
              <option value="">All</option>
              <option value="in-use">In use</option>
              <option value="unused">Unused</option>
            </select>
          </div>

          <div class="filter-group">
            <label>Modified</label>
            <select v-model="rangePreset">
              <option value="all">All time</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="year">This year</option>
              <option value="custom">Custom…</option>
            </select>
          </div>

          <template v-if="rangePreset === 'custom'">
            <div class="filter-group">
              <label>From</label>
              <input type="date" v-model="customFrom" />
            </div>
            <div class="filter-group">
              <label>To</label>
              <input type="date" v-model="customTo" />
            </div>
          </template>

          <div class="filter-group">
            <label>Per page</label>
            <select v-model="pageSize">
              <option :value="25">25</option>
              <option :value="50">50</option>
              <option :value="100">100</option>
              <option :value="0">All</option>
            </select>
          </div>

          <div class="filter-summary">
            Showing <strong>{{ filteredFiles.length }}</strong> of {{ data.files.length }}
            <button v-if="hasActiveFilters" type="button" class="filter-clear" @click="clearFilters">Clear filters</button>
          </div>
        </div>

        <div v-if="!filteredFiles.length" class="empty no-match">
          <p>No files match the current filters.</p>
          <button type="button" class="btn-secondary" @click="clearFilters">Clear filters</button>
        </div>

        <div v-else class="table-wrap"><table class="files-table">
          <thead>
            <tr>
              <th class="sortable" :class="{ active: sortKey === 'name' }" @click="setSort('name')">
                Name <span class="sort-arrow">{{ sortArrow('name') }}</span>
              </th>
              <th class="col-size sortable" :class="{ active: sortKey === 'size' }" @click="setSort('size')">
                Size <span class="sort-arrow">{{ sortArrow('size') }}</span>
              </th>
              <th class="col-modified sortable" :class="{ active: sortKey === 'modified' }" @click="setSort('modified')">
                Modified <span class="sort-arrow">{{ sortArrow('modified') }}</span>
              </th>
              <th class="col-status">Status</th>
              <th class="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in pagedFiles" :key="f.name">
              <td class="col-name" data-label="Name">
                <span v-if="kind === 'artwork' && isImage(f.name)" class="thumb-cell">
                  <img :src="f.url" :alt="f.name" class="thumb" />
                </span>
                <span class="filename">{{ f.name }}</span>
              </td>
              <td class="col-size" data-label="Size">{{ formatSize(f.size) }}</td>
              <td class="col-modified" data-label="Modified">{{ f.modifiedAt ? formatDate(f.modifiedAt) : '—' }}</td>
              <td class="col-status" data-label="Status">
                <span v-if="f.inUse" class="badge in-use" :title="f.usedBy.join('\n')">In use</span>
                <span v-else class="badge unused">Unused</span>
              </td>
              <td class="col-actions">
                <div class="row-menu">
                  <button
                    type="button"
                    class="row-menu-btn"
                    :class="{ open: openMenuId === f.name }"
                    :aria-expanded="openMenuId === f.name"
                    aria-haspopup="true"
                    aria-label="File actions"
                    @click.stop="toggleMenu(f.name, $event)"
                  >⋯</button>
                  <div v-if="openMenuId === f.name" class="row-menu-panel" :class="{ up: menuDirection === 'up' }" role="menu" @click.stop>
                    <button
                      type="button"
                      class="row-menu-item"
                      role="menuitem"
                      @click="copyUrl(f.url); closeMenu()"
                    >Copy URL</button>
                    <button
                      type="button"
                      class="row-menu-item"
                      role="menuitem"
                      @click="startRename(f); closeMenu()"
                    >Rename</button>
                    <div class="row-menu-divider"></div>
                    <button
                      type="button"
                      class="row-menu-item danger"
                      role="menuitem"
                      @click="confirmDelete(f); closeMenu()"
                    >Delete</button>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table></div>

        <div v-if="totalPages > 1" class="pagination">
          <button
            type="button"
            class="page-btn"
            :disabled="currentPage <= 1"
            @click="goToPage(currentPage - 1)"
          >‹ Prev</button>
          <span class="page-info">
            Page <strong>{{ currentPage }}</strong> of {{ totalPages }}
            <span class="page-range">({{ pageRangeStart }}–{{ pageRangeEnd }} of {{ filteredFiles.length }})</span>
          </span>
          <button
            type="button"
            class="page-btn"
            :disabled="currentPage >= totalPages"
            @click="goToPage(currentPage + 1)"
          >Next ›</button>
        </div>
      </template>
    </div>

    <!-- Delete confirmation -->
    <div v-if="deleteTarget" class="modal-overlay" @click.self="deleteTarget = null">
      <div class="modal">
        <h3>Delete file?</h3>
        <p>
          Permanently delete <strong>{{ deleteTarget.name }}</strong> from the {{ kind }} directory?
        </p>
        <div v-if="deleteTarget.inUse" class="warn-box">
          <strong>This file is in use.</strong>
          <ul>
            <li v-for="ref in deleteTarget.usedBy" :key="ref">{{ ref }}</li>
          </ul>
          <p>The references will be left pointing to a missing file. You can fix them afterward.</p>
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" @click="deleteTarget = null">Cancel</button>
          <button class="btn-danger" :disabled="deleting" @click="doDelete">
            {{ deleting ? 'Deleting…' : (deleteTarget.inUse ? 'Delete anyway' : 'Delete') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Rename modal -->
    <div v-if="renameTarget" class="modal-overlay" @click.self="renameTarget = null">
      <div class="modal">
        <h3>Rename file</h3>
        <div class="form-group">
          <label>From</label>
          <div class="dim-text">{{ renameTarget.name }}</div>
        </div>
        <div class="form-group">
          <label>To</label>
          <input v-model="renameTo" type="text" />
          <p class="hint">Letters, numbers, dot, underscore, dash. No slashes.</p>
        </div>
        <div v-if="renameTarget.inUse" class="warn-box">
          <strong>This file is in use.</strong>
          <ul>
            <li v-for="ref in renameTarget.usedBy" :key="ref">{{ ref }}</li>
          </ul>
          <label class="check-row">
            <input type="checkbox" v-model="renameUpdateRefs" />
            Update references to point at the new file
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" @click="renameTarget = null">Cancel</button>
          <button class="btn-primary" :disabled="renaming || !renameTo" @click="doRename">
            {{ renaming ? 'Renaming…' : 'Rename' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const podcastSlug = route.params.slug as string

interface FileEntry {
  name: string
  size: number
  modifiedAt: string | null
  url: string
  inUse: boolean
  usedBy: string[]
}
interface ListResponse {
  kind: 'audio' | 'artwork'
  publicUrlBase: string
  files: FileEntry[]
}

const kind = ref<'audio' | 'artwork'>('audio')
const data = ref<ListResponse | null>(null)
const loading = ref(false)
const errorMsg = ref('')
const successMsg = ref('')

const { uploading, uploadProgress, uploadFile } = useUpload(podcastSlug)
const { openMenuId, menuDirection, toggleMenu, closeMenu } = useRowMenu()

// Sort + filter state. Persists across audio/artwork tab switches.
type SortKey = 'name' | 'size' | 'modified'
const sortKey = ref<SortKey>('name')
const sortDir = ref<'asc' | 'desc'>('asc')

const searchInput = ref('')
const debouncedSearch = ref('')
let searchDebounceHandle: ReturnType<typeof setTimeout> | null = null
watch(searchInput, (value) => {
  if (searchDebounceHandle) clearTimeout(searchDebounceHandle)
  searchDebounceHandle = setTimeout(() => {
    debouncedSearch.value = value.trim().toLowerCase()
  }, 200)
})
onBeforeUnmount(() => {
  if (searchDebounceHandle) clearTimeout(searchDebounceHandle)
})

const statusFilter = ref<'' | 'in-use' | 'unused'>('')
const rangePreset = ref<'all' | '30' | '90' | 'year' | 'custom'>('all')
const customFrom = ref('')
const customTo = ref('')

const hasActiveFilters = computed(() =>
  statusFilter.value !== ''
  || rangePreset.value !== 'all'
  || debouncedSearch.value !== '',
)

function clearFilters() {
  statusFilter.value = ''
  searchInput.value = ''
  debouncedSearch.value = ''
  rangePreset.value = 'all'
  customFrom.value = ''
  customTo.value = ''
}

function setSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    // Sensible default direction per column: name asc, size/modified desc.
    sortDir.value = key === 'name' ? 'asc' : 'desc'
  }
}

function sortArrow(key: SortKey): string {
  if (sortKey.value !== key) return ''
  return sortDir.value === 'asc' ? '↑' : '↓'
}

const filteredFiles = computed(() => {
  if (!data.value) return []
  const files = data.value.files

  // Date range
  const now = new Date()
  let from: Date | null = null
  let to: Date | null = null
  if (rangePreset.value === '30') {
    from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  } else if (rangePreset.value === '90') {
    from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
  } else if (rangePreset.value === 'year') {
    from = new Date(now.getFullYear(), 0, 1)
  } else if (rangePreset.value === 'custom') {
    if (customFrom.value) from = new Date(customFrom.value + 'T00:00:00')
    if (customTo.value) to = new Date(customTo.value + 'T23:59:59')
  }

  const q = debouncedSearch.value
  const filtered = files.filter((f) => {
    if (statusFilter.value === 'in-use' && !f.inUse) return false
    if (statusFilter.value === 'unused' && f.inUse) return false
    if (q && !f.name.toLowerCase().includes(q)) return false
    if (from || to) {
      if (!f.modifiedAt) return false
      const d = new Date(f.modifiedAt)
      if (from && d < from) return false
      if (to && d > to) return false
    }
    return true
  })

  // Sort (clone first — never mutate the source array)
  const sorted = filtered.slice()
  const dir = sortDir.value === 'asc' ? 1 : -1
  sorted.sort((a, b) => {
    if (sortKey.value === 'name') {
      return a.name.localeCompare(b.name) * dir
    }
    if (sortKey.value === 'size') {
      return (a.size - b.size) * dir
    }
    // modified — null-safe; nulls sort to the end regardless of direction
    const at = a.modifiedAt ? new Date(a.modifiedAt).getTime() : NaN
    const bt = b.modifiedAt ? new Date(b.modifiedAt).getTime() : NaN
    if (isNaN(at) && isNaN(bt)) return 0
    if (isNaN(at)) return 1
    if (isNaN(bt)) return -1
    return (at - bt) * dir
  })
  return sorted
})

// Pagination
const pageSize = ref<number>(50)
const currentPage = ref<number>(1)

const totalPages = computed(() => {
  if (pageSize.value === 0) return 1
  return Math.max(1, Math.ceil(filteredFiles.value.length / pageSize.value))
})

const pagedFiles = computed(() => {
  if (pageSize.value === 0) return filteredFiles.value
  const start = (currentPage.value - 1) * pageSize.value
  return filteredFiles.value.slice(start, start + pageSize.value)
})

const pageRangeStart = computed(() => {
  if (filteredFiles.value.length === 0) return 0
  if (pageSize.value === 0) return 1
  return (currentPage.value - 1) * pageSize.value + 1
})

const pageRangeEnd = computed(() => {
  if (pageSize.value === 0) return filteredFiles.value.length
  return Math.min(currentPage.value * pageSize.value, filteredFiles.value.length)
})

function goToPage(p: number) {
  if (p < 1 || p > totalPages.value) return
  currentPage.value = p
  closeMenu()
  if (typeof window !== 'undefined') {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
}

// Reset to page 1 whenever filters, sort, kind, or page size change
watch(
  [statusFilter, debouncedSearch, rangePreset, customFrom, customTo, sortKey, sortDir, kind, pageSize],
  () => { currentPage.value = 1 },
)

// Keep current page in range if filtered list shrinks
watch(totalPages, (n) => {
  if (currentPage.value > n) currentPage.value = n
})

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    data.value = await $fetch<ListResponse>(`/api/podcasts/${podcastSlug}/files`, {
      query: { kind: kind.value },
    })
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Failed to load files'
    data.value = null
  } finally {
    loading.value = false
  }
}

async function reload() {
  await load()
}

function setKind(k: 'audio' | 'artwork') {
  if (kind.value === k) return
  kind.value = k
  data.value = null
  load()
}

onMounted(load)

async function handleUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  errorMsg.value = ''
  successMsg.value = ''
  try {
    await uploadFile(file, kind.value)
    successMsg.value = `Uploaded ${file.name}.`
    setTimeout(() => { successMsg.value = '' }, 3500)
    await load()
  } catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : 'Upload failed'
  } finally {
    input.value = ''
  }
}

async function copyUrl(url: string) {
  try {
    await navigator.clipboard.writeText(url)
    successMsg.value = 'URL copied to clipboard.'
    setTimeout(() => { successMsg.value = '' }, 2000)
  } catch {
    successMsg.value = url
  }
}

const deleteTarget = ref<FileEntry | null>(null)
const deleting = ref(false)

function confirmDelete(f: FileEntry) {
  deleteTarget.value = f
}

async function doDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  errorMsg.value = ''
  try {
    await $fetch(`/api/podcasts/${podcastSlug}/files/delete`, {
      method: 'POST',
      body: { kind: kind.value, name: deleteTarget.value.name, force: deleteTarget.value.inUse },
    })
    successMsg.value = `Deleted ${deleteTarget.value.name}.`
    setTimeout(() => { successMsg.value = '' }, 3500)
    deleteTarget.value = null
    await load()
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Delete failed'
  } finally {
    deleting.value = false
  }
}

const renameTarget = ref<FileEntry | null>(null)
const renameTo = ref('')
const renameUpdateRefs = ref(true)
const renaming = ref(false)

function startRename(f: FileEntry) {
  renameTarget.value = f
  renameTo.value = f.name
  renameUpdateRefs.value = f.inUse
}

async function doRename() {
  if (!renameTarget.value || !renameTo.value) return
  renaming.value = true
  errorMsg.value = ''
  try {
    const result = await $fetch<{ updatedEpisodes: number; updatedPodcast: boolean }>(
      `/api/podcasts/${podcastSlug}/files/rename`,
      {
        method: 'POST',
        body: {
          kind: kind.value,
          fromName: renameTarget.value.name,
          toName: renameTo.value,
          updateReferences: renameUpdateRefs.value,
        },
      },
    )
    const updated = (result.updatedEpisodes || 0) + (result.updatedPodcast ? 1 : 0)
    successMsg.value = updated
      ? `Renamed and updated ${updated} reference${updated === 1 ? '' : 's'}.`
      : 'Renamed.'
    setTimeout(() => { successMsg.value = '' }, 3500)
    renameTarget.value = null
    await load()
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Rename failed'
  } finally {
    renaming.value = false
  }
}

function isImage(name: string): boolean {
  return /\.(jpe?g|png|webp|gif)$/i.test(name)
}

function formatSize(bytes: number): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes, i = 0
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

useHead({ title: 'Files — Podshelf Admin' })
</script>

<style scoped>
* { box-sizing: border-box; }

.admin-page { min-height: 100vh; background: #f7fafc; font-family: system-ui, sans-serif; }
.container { max-width: 1080px; margin: 0 auto; padding: 2rem 1.25rem; }
h1 { margin: 0 0 0.25rem; font-size: 1.5rem; color: #1a202c; }
.hint { font-size: 0.85rem; color: #718096; margin-bottom: 1.25rem; }
.hint code {
  background: #edf2f7;
  padding: 0.1em 0.35em;
  border-radius: 3px;
  font-size: 0.85em;
}

.tabs {
  display: flex;
  gap: 0.25rem;
  margin-bottom: 1rem;
  align-items: center;
}
.tab {
  padding: 0.5rem 1rem;
  background: white;
  border: 1px solid #e2e8f0;
  color: #4a5568;
  font-size: 0.9rem;
  border-radius: 6px;
  cursor: pointer;
}
.tab.active {
  background: #ebf4ff;
  border-color: #c3dafe;
  color: #4c51bf;
  font-weight: 500;
}
.refresh-btn {
  margin-left: auto;
  padding: 0.4rem 0.875rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.85rem;
  color: #4a5568;
  cursor: pointer;
}
.refresh-btn:hover:not(:disabled) { background: #f7fafc; }

.upload-row {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  margin-bottom: 1rem;
}
.btn-upload {
  display: inline-flex;
  align-items: center;
  padding: 0.5rem 0.875rem;
  background: #ebf4ff;
  border: 1px solid #c3dafe;
  color: #4c51bf;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}
.btn-upload:hover { background: #c3dafe; }
.dir-info {
  font-size: 0.8rem;
  color: #718096;
  word-break: break-all;
}

.loading, .empty {
  text-align: center;
  color: #718096;
  padding: 2.5rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
}

.error-msg {
  background: #fff5f5;
  border: 1px solid #fc8181;
  color: #c53030;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  margin-bottom: 1rem;
}
.success-msg {
  background: #f0fff4;
  border: 1px solid #9ae6b4;
  color: #276749;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  margin-bottom: 1rem;
}

.files-table {
  width: 100%;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  border-collapse: collapse;
  overflow: hidden;
}
.files-table th {
  background: #f7fafc;
  text-align: left;
  padding: 0.75rem 1rem;
  font-size: 0.72rem;
  font-weight: 600;
  color: #718096;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid #e2e8f0;
}
.files-table td {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #f0f4f8;
  vertical-align: middle;
  font-size: 0.875rem;
}
.files-table tr:last-child td { border-bottom: none; }

.col-size { width: 90px; }
.col-modified { width: 170px; color: #718096; font-size: 0.8rem; }
.col-status { width: 100px; }
.col-actions { width: 64px; text-align: right; }

.files-table th.sortable {
  cursor: pointer;
  user-select: none;
}
.files-table th.sortable:hover { color: #4a5568; }
.files-table th.sortable.active { color: #4c51bf; }
.sort-arrow {
  display: inline-block;
  width: 0.7rem;
  margin-left: 0.15rem;
  font-size: 0.78rem;
  color: inherit;
}

.col-name { display: flex; align-items: center; gap: 0.625rem; }
.thumb-cell { flex-shrink: 0; }
.thumb {
  width: 36px;
  height: 36px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid #e2e8f0;
}
.filename { word-break: break-all; }

.badge {
  display: inline-block;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
}
.badge.in-use { background: #fef5e7; color: #b7791f; cursor: help; }
.badge.unused { background: #edf2f7; color: #718096; }

/* Filter bar */
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.875rem 1rem;
  align-items: end;
  padding: 0.875rem 1rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  margin-bottom: 1rem;
}
.filter-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.filter-group label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #718096;
  font-weight: 600;
}
.filter-group select,
.filter-group input[type="date"],
.filter-group input[type="search"] {
  padding: 0.4rem 0.6rem;
  border: 1px solid #e2e8f0;
  border-radius: 5px;
  font-size: 0.85rem;
  background: white;
  color: #2d3748;
  outline: none;
}
.filter-group select:focus,
.filter-group input[type="date"]:focus,
.filter-group input[type="search"]:focus {
  border-color: #667eea;
}
.filter-search { flex: 1; min-width: 200px; }
.filter-search input[type="search"] { width: 100%; }
.filter-summary {
  margin-left: auto;
  font-size: 0.85rem;
  color: #4a5568;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.filter-clear {
  background: none;
  border: none;
  color: #667eea;
  cursor: pointer;
  font-size: 0.8rem;
  padding: 0;
}
.filter-clear:hover { text-decoration: underline; }
.empty.no-match { padding: 1.5rem; }

/* Row hamburger menu */
.row-menu {
  position: relative;
  display: inline-block;
}
.row-menu-btn {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  width: 32px;
  height: 30px;
  font-size: 1.1rem;
  line-height: 1;
  color: #4a5568;
  cursor: pointer;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}
.row-menu-btn:hover, .row-menu-btn.open {
  border-color: #667eea;
  color: #667eea;
  background: #f7fafc;
}
.row-menu-panel {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 160px;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 0.3rem;
  box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.18);
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  text-align: left;
}
.row-menu-panel.up {
  top: auto;
  bottom: calc(100% + 4px);
}
.row-menu-item {
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 0.45rem 0.65rem;
  background: none;
  border: none;
  border-radius: 5px;
  color: #2d3748;
  font-size: 0.85rem;
  font-family: inherit;
  text-decoration: none;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
}
.row-menu-item:hover:not(:disabled) {
  background: #f7fafc;
  color: #1a202c;
}
.row-menu-item:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.row-menu-item.danger { color: #c53030; }
.row-menu-item.danger:hover:not(:disabled) {
  background: #fff5f5;
  color: #9b2c2c;
}
.row-menu-divider {
  height: 1px;
  background: #f0f4f8;
  margin: 0.25rem 0.1rem;
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal {
  background: white;
  border-radius: 10px;
  padding: 1.75rem;
  max-width: 480px;
  width: 90%;
}
.modal h3 { margin: 0 0 0.75rem; font-size: 1.1rem; }
.modal p { color: #4a5568; font-size: 0.9rem; margin: 0 0 1rem; }

.form-group { margin-bottom: 0.875rem; }
.form-group label {
  display: block;
  font-size: 0.78rem;
  font-weight: 600;
  color: #4a5568;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 0.25rem;
}
.form-group input[type="text"] {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.9rem;
  outline: none;
}
.form-group input:focus { border-color: #667eea; }
.dim-text { color: #4a5568; font-family: monospace; word-break: break-all; }

.warn-box {
  background: #fffaf0;
  border: 1px solid #f6ad55;
  border-radius: 6px;
  padding: 0.75rem;
  margin: 0.75rem 0 1rem;
  font-size: 0.85rem;
  color: #744210;
}
.warn-box strong { display: block; margin-bottom: 0.25rem; }
.warn-box ul { margin: 0.25rem 0 0.5rem 1rem; padding: 0; }
.warn-box li { margin: 0; }
.check-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin-top: 0.625rem;
  font-size: 0.85rem;
  color: #744210;
  cursor: pointer;
}

.modal-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
  margin-top: 0.5rem;
}
.btn-primary {
  padding: 0.55rem 1.1rem;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
}
.btn-primary:hover:not(:disabled) { background: #5a67d8; }
.btn-secondary {
  padding: 0.55rem 1.1rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.875rem;
  cursor: pointer;
  color: #4a5568;
}
.btn-secondary:hover { background: #f7fafc; }
.btn-danger {
  padding: 0.55rem 1.1rem;
  background: #e53e3e;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
}
.btn-danger:hover:not(:disabled) { background: #c53030; }
button:disabled { opacity: 0.6; cursor: not-allowed; }

.table-wrap {
  width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  border-radius: 10px;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  margin-top: 1rem;
  padding: 0.75rem 1rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  font-size: 0.875rem;
  color: #4a5568;
  flex-wrap: wrap;
}
.page-btn {
  padding: 0.4rem 0.85rem;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: white;
  color: #4a5568;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.15s;
}
.page-btn:hover:not(:disabled) {
  border-color: #667eea;
  color: #667eea;
}
.page-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.page-info { color: #4a5568; }
.page-info strong { color: #1a202c; }
.page-range { color: #a0aec0; margin-left: 0.35rem; }

@media (max-width: 720px) {
  .container { padding: 1rem 0.75rem; }
  .tabs { flex-wrap: wrap; }
  .tab { min-height: 44px; padding: 0.6rem 1rem; }
  .refresh-btn { margin-left: 0; min-height: 44px; padding: 0.6rem 1rem; }
  .upload-row {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }
  .btn-upload { min-height: 44px; padding: 0.6rem 1rem; justify-content: center; }
  .dir-info { font-size: 0.75rem; }
  .files-table { min-width: 720px; }
  .files-table th,
  .files-table td {
    padding: 0.5rem 0.625rem;
    font-size: 0.825rem;
  }
  .col-name { gap: 0.5rem; }
  .thumb { width: 32px; height: 32px; }
  .filter-bar {
    padding: 0.625rem 0.75rem;
    gap: 0.625rem 0.75rem;
  }
  .filter-group select,
  .filter-group input[type="date"],
  .filter-group input[type="search"] {
    padding: 0.55rem 0.6rem;
    font-size: 0.875rem;
    min-height: 40px;
  }
  .filter-summary {
    margin-left: 0;
    width: 100%;
    justify-content: space-between;
  }
  .modal {
    padding: 1.25rem;
    max-height: 86vh;
    overflow-y: auto;
  }
  .modal-actions {
    flex-direction: column-reverse;
  }
  .modal-actions button {
    width: 100%;
    min-height: 44px;
  }
  /* Pin native checkbox size — balloons at larger label fonts otherwise.
     Inline-block + vertical-align keeps it on the same line as its label. */
  input[type="checkbox"] {
    display: inline-block;
    width: 18px;
    height: 18px;
    margin: 0;
    flex-shrink: 0;
    vertical-align: middle;
  }
}

@media (max-width: 520px) {
  /* Files: card layout for the file table at very narrow widths.
     Same approach as the episodes table — preserves all info but stacks. */
  .table-wrap { overflow-x: visible; border-radius: 0; }
  .files-table {
    display: block;
    min-width: 0;
    border: none;
    background: transparent;
    overflow: visible;
  }
  .files-table thead { display: none; }
  .files-table tbody { display: block; }
  .files-table tr {
    display: flex;
    flex-direction: column;
    background: white;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    margin-bottom: 0.625rem;
    padding: 0.875rem 1rem;
  }
  .files-table td {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0;
    border-bottom: none;
    width: auto;
    min-width: 0;
    font-size: 0.85rem;
  }
  .col-name {
    padding-bottom: 0.5rem;
    margin-bottom: 0.5rem;
    border-bottom: 1px solid #f0f4f8;
    font-weight: 600;
    word-break: break-all;
  }
  .col-size::before { content: "Size"; }
  .col-modified::before { content: "Modified"; }
  .col-status::before { content: "Status"; }
  .col-size::before, .col-modified::before, .col-status::before {
    color: #a0aec0;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
    width: 70px;
    flex-shrink: 0;
  }
  .col-actions {
    justify-content: flex-end;
    padding-top: 0.625rem;
    margin-top: 0.5rem;
    border-top: 1px solid #f0f4f8;
    text-align: right;
    width: auto;
  }
  .row-menu-btn {
    width: 40px;
    height: 40px;
    font-size: 1.2rem;
  }
}
</style>
