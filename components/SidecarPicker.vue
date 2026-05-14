<template>
  <Teleport to="body">
    <div v-if="open" class="sp-overlay" @click.self="close">
      <div class="sp-modal">
        <div class="sp-header">
          <h3>{{ title }}</h3>
          <button class="sp-close" type="button" @click="close" aria-label="Close">×</button>
        </div>

        <p class="sp-hint">Showing files from your audio storage directory matching {{ extensionsLabel }}.</p>

        <p v-if="errorMsg" class="sp-error">{{ errorMsg }}</p>
        <p v-else-if="loading" class="sp-loading">Loading files…</p>

        <div v-else-if="!matchingFiles.length" class="sp-empty">
          <p>No matching files in your audio directory.</p>
          <p class="sp-empty-hint">Upload one from the form above, or visit the Files page.</p>
        </div>

        <div v-else class="sp-list">
          <button
            v-for="f in matchingFiles"
            :key="f.name"
            type="button"
            class="sp-row"
            :class="{ 'in-use': f.inUse }"
            :title="f.usedBy.length ? f.usedBy.join('\n') : ''"
            @click="pick(f)"
          >
            <div class="sp-row-name">{{ f.name }}</div>
            <div class="sp-row-meta">
              <span>{{ formatSize(f.size) }}</span>
              <span v-if="f.modifiedAt" class="sp-row-date">{{ formatDate(f.modifiedAt) }}</span>
              <span v-if="f.inUse" class="sp-row-used">In use</span>
            </div>
          </button>
        </div>

        <div class="sp-footer">
          <button class="sp-btn-secondary" type="button" @click="close">Cancel</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
const props = defineProps<{
  open: boolean
  podcastSlug: string
  title: string
  extensions: string[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'select', payload: { url: string; name: string }): void
}>()

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

const data = ref<ListResponse | null>(null)
const loading = ref(false)
const errorMsg = ref('')

const extensionsLabel = computed(() => props.extensions.map((e) => e.startsWith('.') ? e : `.${e}`).join(' / '))

const matchingFiles = computed(() => {
  const exts = props.extensions.map((e) => (e.startsWith('.') ? e : `.${e}`).toLowerCase())
  return (data.value?.files || []).filter((f) => {
    const lower = f.name.toLowerCase()
    return exts.some((e) => lower.endsWith(e))
  })
})

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    data.value = await $fetch<ListResponse>(`/api/podcasts/${props.podcastSlug}/files`, {
      query: { kind: 'audio' },
    })
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
      || 'Failed to load files'
    data.value = null
  } finally {
    loading.value = false
  }
}

watch(() => props.open, (v) => { if (v) load() })

function pick(f: FileEntry) {
  emit('select', { url: f.url, name: f.name })
  emit('close')
}
function close() { emit('close') }

function formatSize(bytes: number): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes, i = 0
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}
</script>

<style scoped>
.sp-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex; align-items: center; justify-content: center;
  z-index: 1100;
}
.sp-modal {
  background: white;
  border-radius: 12px;
  width: min(720px, 95vw);
  max-height: 90vh;
  display: flex; flex-direction: column;
  padding: 1.25rem 1.25rem 1rem;
  font-family: system-ui, sans-serif;
}
.sp-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 0.5rem;
}
.sp-header h3 { margin: 0; font-size: 1.15rem; }
.sp-close {
  background: none; border: none;
  font-size: 1.6rem; color: #718096; cursor: pointer;
  padding: 0; line-height: 1;
  width: 44px; height: 44px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 8px;
}
.sp-close:hover { color: #1a202c; background: #f7fafc; }

.sp-hint { color: #718096; font-size: 0.82rem; margin: 0 0 0.875rem; }

.sp-error {
  background: #fff5f5; border: 1px solid #fc8181; color: #c53030;
  padding: 0.75rem; border-radius: 6px; font-size: 0.875rem;
}
.sp-loading, .sp-empty { padding: 2rem; text-align: center; color: #718096; }
.sp-empty-hint { font-size: 0.85rem; margin-top: 0.25rem; }

.sp-list {
  display: flex; flex-direction: column; gap: 0.4rem;
  overflow-y: auto;
  padding: 0.25rem;
}
.sp-row {
  text-align: left;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 0.625rem 0.875rem;
  cursor: pointer;
  display: flex; flex-direction: column; gap: 0.2rem;
  transition: all 0.12s;
}
.sp-row:hover {
  border-color: #667eea;
  background: #f7faff;
  transform: translateY(-1px);
}
.sp-row.in-use { background: #fffaf0; }
.sp-row-name {
  color: #2d3748;
  font-weight: 500;
  font-size: 0.9rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.sp-row-meta {
  display: flex; gap: 0.6rem; align-items: center;
  font-size: 0.74rem; color: #718096;
}
.sp-row-date { color: #a0aec0; }
.sp-row-used {
  background: #fef5e7; color: #b7791f;
  border: 1px solid #f6ad55; border-radius: 999px;
  padding: 0.05rem 0.45rem;
  font-weight: 600; letter-spacing: 0.02em;
  margin-left: auto;
}

.sp-footer {
  display: flex; justify-content: flex-end;
  margin-top: 0.875rem; padding-top: 0.875rem;
  border-top: 1px solid #f0f4f8;
}
.sp-btn-secondary {
  padding: 0.5rem 1rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.875rem; color: #4a5568;
  cursor: pointer;
}
.sp-btn-secondary:hover { background: #f7fafc; }

@media (max-width: 720px) {
  .sp-modal {
    width: 100vw; max-height: 100vh; height: 100vh;
    border-radius: 0; padding: 0.875rem 0.875rem 0.75rem;
  }
}
</style>
