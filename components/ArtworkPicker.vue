<template>
  <Teleport to="body">
    <div v-if="open" class="ap-overlay" @click.self="close">
      <div class="ap-modal">
        <div class="ap-header">
          <h3>Choose Artwork</h3>
          <button class="ap-close" type="button" @click="close" aria-label="Close">×</button>
        </div>

        <p v-if="errorMsg" class="ap-error">{{ errorMsg }}</p>
        <p v-else-if="loading" class="ap-loading">Loading artwork…</p>

        <div v-else-if="!data || !data.files.length" class="ap-empty">
          <p>No artwork in the artwork directory yet.</p>
          <p class="ap-hint">Upload an image from the episode form or the Files page.</p>
        </div>

        <div v-else class="ap-grid">
          <button
            v-for="f in imageFiles"
            :key="f.name"
            type="button"
            class="ap-tile"
            :class="{ selected: selected === f.name, 'in-use': f.inUse }"
            @click="pick(f)"
            :title="f.usedBy.length ? f.usedBy.join('\n') : ''"
          >
            <img :src="f.url" :alt="f.name" loading="lazy" />
            <div class="ap-meta">
              <div class="ap-name">{{ f.name }}</div>
              <div class="ap-sub">
                {{ formatSize(f.size) }}
                <span v-if="f.inUse" class="ap-used">In use</span>
              </div>
            </div>
          </button>
        </div>

        <div class="ap-footer">
          <button class="ap-btn-secondary" type="button" @click="close">Cancel</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
const props = defineProps<{
  open: boolean
  podcastSlug: string
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
const selected = ref<string | null>(null)

const imageFiles = computed(() =>
  (data.value?.files || []).filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f.name)),
)

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    data.value = await $fetch<ListResponse>(`/api/podcasts/${props.podcastSlug}/files`, {
      query: { kind: 'artwork' },
    })
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
      || 'Failed to load artwork'
    data.value = null
  } finally {
    loading.value = false
  }
}

watch(() => props.open, (v) => {
  if (v) {
    selected.value = null
    load()
  }
})

function pick(f: FileEntry) {
  selected.value = f.name
  emit('select', { url: f.url, name: f.name })
  emit('close')
}

function close() {
  emit('close')
}

function formatSize(bytes: number): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes, i = 0
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}
</script>

<style scoped>
.ap-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
}
.ap-modal {
  background: white;
  border-radius: 12px;
  width: min(900px, 95vw);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  padding: 1.25rem 1.25rem 1rem;
  font-family: system-ui, sans-serif;
}
.ap-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.875rem;
}
.ap-header h3 { margin: 0; font-size: 1.15rem; }
.ap-close {
  background: none;
  border: none;
  font-size: 1.6rem;
  color: #718096;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}
.ap-close:hover { color: #1a202c; }

.ap-error {
  background: #fff5f5;
  border: 1px solid #fc8181;
  color: #c53030;
  padding: 0.75rem;
  border-radius: 6px;
  font-size: 0.875rem;
}
.ap-loading, .ap-empty {
  padding: 2rem;
  text-align: center;
  color: #718096;
}
.ap-hint { font-size: 0.85rem; margin-top: 0.25rem; }

.ap-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 0.875rem;
  overflow-y: auto;
  padding: 0.25rem;
}

.ap-tile {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  cursor: pointer;
  padding: 0;
  text-align: left;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: all 0.15s;
}
.ap-tile:hover {
  border-color: #667eea;
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(102, 126, 234, 0.18);
}
.ap-tile.selected { border-color: #4c51bf; box-shadow: 0 0 0 2px #c3dafe; }
.ap-tile.in-use { background: #fffaf0; }
.ap-tile img {
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  background: #edf2f7;
  display: block;
}
.ap-meta {
  padding: 0.5rem 0.625rem 0.625rem;
  font-size: 0.78rem;
}
.ap-name {
  color: #2d3748;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ap-sub {
  margin-top: 0.2rem;
  font-size: 0.7rem;
  color: #718096;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.ap-used {
  background: #fef5e7;
  color: #b7791f;
  border: 1px solid #f6ad55;
  border-radius: 999px;
  padding: 0.05rem 0.45rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.ap-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 0.875rem;
  padding-top: 0.875rem;
  border-top: 1px solid #f0f4f8;
}
.ap-btn-secondary {
  padding: 0.5rem 1rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.875rem;
  color: #4a5568;
  cursor: pointer;
}
.ap-btn-secondary:hover { background: #f7fafc; }

@media (max-width: 720px) {
  .ap-modal {
    width: 100vw;
    max-height: 100vh;
    height: 100vh;
    border-radius: 0;
    padding: 0.875rem 0.875rem 0.75rem;
  }
  .ap-grid {
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 0.625rem;
  }
}
</style>
