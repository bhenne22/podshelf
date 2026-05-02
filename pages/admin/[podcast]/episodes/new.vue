<template>
  <div class="admin-page">
    <AdminNav :podcast-slug="podcastSlug" />
    <div class="container">
      <div class="page-header">
        <h1>New Episode</h1>
        <NuxtLink :to="`/admin/${podcastSlug}/episodes`" class="btn-back">← Back to Episodes</NuxtLink>
      </div>

      <div v-if="successMsg" class="success-msg">{{ successMsg }}</div>
      <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

      <form @submit.prevent="onSubmit" class="episode-form">
        <div class="form-section">
          <h2>Basic Info</h2>
          <div class="form-row">
            <div class="form-group flex-2">
              <label for="title">Title <span class="required">*</span></label>
              <input
                id="title"
                v-model="form.title"
                type="text"
                placeholder="Episode title"
                required
                @input="autoSlug"
              />
            </div>
            <div class="form-group">
              <label for="episode_number">Episode #</label>
              <input id="episode_number" v-model.number="form.episode_number" type="number" min="1" placeholder="e.g. 42" />
            </div>
            <div class="form-group">
              <label for="season_number">Season #</label>
              <input id="season_number" v-model.number="form.season_number" type="number" min="1" placeholder="e.g. 2" />
            </div>
          </div>

          <div class="form-group">
            <label for="slug">
              Slug
              <span class="hint">Auto-generated from title. Used in URL: /episodes/<em>slug</em></span>
            </label>
            <input id="slug" v-model="form.slug" type="text" placeholder="my-episode-title" />
          </div>

          <div class="form-group">
            <label for="description">Show Notes / Description</label>
            <RichTextEditor
              v-model="form.description"
              :rows="10"
              placeholder="Describe your episode, add links, timestamps, etc."
            />
          </div>

          <div class="form-group">
            <label for="tags">Tags</label>
            <input id="tags" v-model="form.tags" type="text" placeholder="running, ultramarathon, gear (comma-separated)" />
          </div>
        </div>

        <div class="form-section">
          <h2>Audio</h2>
          <div class="form-group">
            <label for="audio_file">Upload Audio File</label>
            <input
              id="audio_file"
              type="file"
              accept="audio/*"
              @change="handleFileChange"
              class="file-input"
            />
            <p class="hint">MP3 or M4A recommended. File will be uploaded to your configured storage.</p>
          </div>

          <div v-if="uploading" class="upload-progress">
            <div class="progress-text">Uploading audio… {{ uploadProgress }}%</div>
            <div class="progress-bar-track">
              <div class="progress-bar-fill" :style="{ width: uploadProgress + '%' }"></div>
            </div>
          </div>

          <div class="form-group">
            <label for="audio_url">Audio URL</label>
            <div class="input-with-action">
              <input
                id="audio_url"
                v-model="form.audio_url"
                type="url"
                placeholder="https://example.com/audio/episode.mp3"
              />
              <button
                type="button"
                class="btn-probe"
                :disabled="!form.audio_url || probing"
                @click="probeAudio"
              >
                {{ probing ? 'Checking…' : 'Check File' }}
              </button>
            </div>
            <p class="hint">Auto-filled after upload, or enter manually. Use "Check File" to detect size &amp; duration.</p>
          </div>

          <div v-if="probeError" class="probe-error">{{ probeError }}</div>

          <div class="form-row">
            <div class="form-group">
              <label for="audio_size">
                File Size (bytes)
                <button type="button" class="lock-toggle" @click="fieldsUnlocked = !fieldsUnlocked" :title="fieldsUnlocked ? 'Lock fields' : 'Unlock for manual editing'">
                  {{ fieldsUnlocked ? 'Lock' : 'Unlock' }}
                </button>
              </label>
              <input
                id="audio_size"
                v-model.number="form.audio_size_bytes"
                type="number"
                min="0"
                placeholder="Auto-detected"
                :readonly="!fieldsUnlocked"
                :class="{ 'field-locked': !fieldsUnlocked }"
              />
            </div>
            <div class="form-group">
              <label for="audio_duration">Duration (seconds)</label>
              <input
                id="audio_duration"
                v-model.number="form.audio_duration_seconds"
                type="number"
                min="0"
                placeholder="Auto-detected"
                :readonly="!fieldsUnlocked"
                :class="{ 'field-locked': !fieldsUnlocked }"
              />
            </div>
            <div v-if="form.audio_duration_seconds" class="form-group">
              <label>Formatted</label>
              <div class="duration-display">{{ formatDuration(form.audio_duration_seconds) }}</div>
            </div>
          </div>
        </div>

        <div class="form-section">
          <h2>Publishing</h2>
          <div class="form-row">
            <div class="form-group">
              <label for="status">Status</label>
              <select id="status" v-model="form.status">
                <option value="draft">Draft</option>
                <option value="published">Published</option>
              </select>
            </div>
            <div class="form-group flex-2">
              <label for="published_at">Publish Date</label>
              <input
                id="published_at"
                v-model="form.published_at"
                type="datetime-local"
              />
            </div>
          </div>
        </div>

        <div class="form-section rss-preview">
          <h2>RSS Preview</h2>
          <div class="preview-grid">
            <div class="preview-item">
              <span class="preview-label">itunes:title</span>
              <span class="preview-value">{{ form.title || '—' }}</span>
            </div>
            <div class="preview-item">
              <span class="preview-label">itunes:episode</span>
              <span class="preview-value">{{ form.episode_number || '—' }}</span>
            </div>
            <div class="preview-item">
              <span class="preview-label">itunes:season</span>
              <span class="preview-value">{{ form.season_number || '—' }}</span>
            </div>
            <div class="preview-item">
              <span class="preview-label">enclosure url</span>
              <span class="preview-value">{{ form.audio_url || '—' }}</span>
            </div>
            <div class="preview-item">
              <span class="preview-label">pubDate</span>
              <span class="preview-value">{{ form.published_at ? new Date(form.published_at).toUTCString() : '—' }}</span>
            </div>
            <div class="preview-item">
              <span class="preview-label">guid (url)</span>
              <span class="preview-value">/episodes/{{ form.slug || '—' }}</span>
            </div>
          </div>
        </div>

        <div class="form-actions">
          <span v-if="saving" class="save-status saving">Saving…</span>
          <span v-else-if="errorMsg" class="save-status err">✗ {{ errorMsg }}</span>
          <NuxtLink :to="`/admin/${podcastSlug}/episodes`" class="btn-secondary">Cancel</NuxtLink>
          <button type="submit" class="btn-primary" :disabled="saving">
            {{ saving ? 'Saving…' : 'Save Draft' }}
          </button>
          <button
            type="button"
            class="btn-publish"
            :disabled="saving"
            @click="saveAndPublish"
          >
            {{ saving ? 'Publishing…' : 'Save & Publish' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'admin-auth' })

const route = useRoute()
const router = useRouter()
const podcastSlug = route.params.podcast as string
const { createEpisode } = useEpisodes(podcastSlug)

const formDirty = ref(false)
const formSaved = ref(false)

const form = reactive({
  title: '',
  slug: '',
  episode_number: null as number | null,
  season_number: null as number | null,
  description: '',
  audio_url: '',
  audio_filename: '',
  audio_size_bytes: null as number | null,
  audio_duration_seconds: null as number | null,
  published_at: '',
  status: 'draft',
  tags: '',
  transcript_path: '',
})

const saving = ref(false)
const probing = ref(false)
const probeError = ref('')
const fieldsUnlocked = ref(false)
const { uploading, uploadProgress, uploadFile } = useUpload(podcastSlug)
const errorMsg = ref('')
const successMsg = ref('')
let slugManuallyEdited = false

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function autoSlug() {
  if (!slugManuallyEdited) {
    form.slug = slugify(form.title)
  }
}

// Watch slug input for manual edits
watch(() => form.slug, (newVal, oldVal) => {
  if (newVal !== slugify(form.title)) {
    slugManuallyEdited = true
  }
})

// Track dirty state for unsaved-changes warning
watch(form, () => { formDirty.value = true }, { deep: true })

onBeforeRouteLeave(() => {
  if (formDirty.value && !formSaved.value) {
    return window.confirm('You have unsaved changes. Leave anyway?')
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
})

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (formDirty.value && !formSaved.value) {
    e.preventDefault()
  }
}

onMounted(() => {
  window.addEventListener('beforeunload', onBeforeUnload)
})

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  errorMsg.value = ''

  try {
    const result = await uploadFile(file)
    form.audio_url = result.url
    form.audio_filename = result.filename
    form.audio_size_bytes = result.size
  } catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : 'Upload failed'
  }
}

async function probeAudio() {
  if (!form.audio_url) return
  probing.value = true
  probeError.value = ''

  try {
    // Get file size via server-side HEAD request
    const probe = await $fetch<{ size: number | null; contentType: string | null }>(
      '/api/audio-probe',
      { query: { url: form.audio_url } }
    )
    if (probe.size) {
      form.audio_size_bytes = probe.size
    }

    // Get duration via browser Audio element
    const audio = new Audio()
    audio.preload = 'metadata'
    const durationPromise = new Promise<number>((resolve, reject) => {
      audio.onloadedmetadata = () => resolve(audio.duration)
      audio.onerror = () => reject(new Error('Could not load audio metadata'))
      setTimeout(() => reject(new Error('Timed out loading audio metadata')), 15000)
    })
    audio.src = form.audio_url
    const duration = await durationPromise
    if (duration && isFinite(duration)) {
      form.audio_duration_seconds = Math.round(duration)
    }
  } catch (err: unknown) {
    probeError.value = err instanceof Error ? err.message : 'Failed to probe audio'
  } finally {
    probing.value = false
  }
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) {
    return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
  }
  return `${m}m ${String(s).padStart(2, '0')}s`
}

async function saveEpisode(publish = false) {
  saving.value = true
  errorMsg.value = ''

  if (publish) {
    form.status = 'published'
    if (!form.published_at) {
      form.published_at = new Date().toISOString().slice(0, 16)
    }
  }

  try {
    const episode = await createEpisode({
      ...form,
      episode_number: form.episode_number || null,
      season_number: form.season_number || null,
      audio_size_bytes: form.audio_size_bytes || null,
      audio_duration_seconds: form.audio_duration_seconds || null,
      published_at: form.published_at || null,
    })
    formSaved.value = true
    await router.push(`/admin/${podcastSlug}/episodes/${episode.id}`)
  } catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : 'Failed to save episode'
  } finally {
    saving.value = false
  }
}

function onSubmit() {
  saveEpisode(false)
}

function saveAndPublish() {
  saveEpisode(true)
}

useHead({ title: 'New Episode — Podshelf Admin' })
</script>

<style scoped>
* { box-sizing: border-box; }

.admin-page {
  min-height: 100vh;
  background: #f7fafc;
  font-family: system-ui, sans-serif;
}

.container {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem 1.25rem;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.5rem;
}

h1 {
  margin: 0;
  font-size: 1.5rem;
  color: #1a202c;
}

.btn-back {
  font-size: 0.875rem;
  color: #667eea;
  text-decoration: none;
}

.btn-back:hover { text-decoration: underline; }

.episode-form {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.form-section {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 1.5rem;
}

.form-section h2 {
  margin: 0 0 1.25rem;
  font-size: 0.95rem;
  font-weight: 600;
  color: #4a5568;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.form-group {
  margin-bottom: 1rem;
}

.form-group:last-child { margin-bottom: 0; }

.form-row {
  display: flex;
  gap: 1rem;
}

.form-row .form-group { flex: 1; }
.form-row .form-group.flex-2 { flex: 2; }

label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: #4a5568;
  margin-bottom: 0.375rem;
}

.required { color: #e53e3e; }

input[type="text"],
input[type="url"],
input[type="number"],
input[type="datetime-local"],
select,
textarea {
  display: block;
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.9rem;
  font-family: system-ui, sans-serif;
  color: #2d3748;
  background: white;
  transition: border-color 0.15s;
  outline: none;
}

input:focus, select:focus, textarea:focus {
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
}

textarea { resize: vertical; line-height: 1.6; }

.file-input {
  padding: 0.375rem;
  background: #f7fafc;
}

.hint {
  font-size: 0.78rem;
  color: #718096;
  margin-top: 0.375rem;
}

.upload-progress {
  padding: 0.75rem 1rem;
  background: #ebf8ff;
  color: #2b6cb0;
  border-radius: 6px;
  font-size: 0.875rem;
  margin-bottom: 1rem;
}

.progress-text { margin-bottom: 0.5rem; }

.progress-bar-track {
  height: 6px;
  background: rgba(43, 108, 176, 0.15);
  border-radius: 3px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: #3182ce;
  border-radius: 3px;
  transition: width 0.15s linear;
}

.input-with-action {
  display: flex;
  gap: 0.5rem;
}

.input-with-action input { flex: 1; }

.btn-probe {
  padding: 0.5rem 0.875rem;
  background: #edf2f7;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 500;
  color: #4a5568;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}

.btn-probe:hover:not(:disabled) {
  background: #e2e8f0;
  border-color: #cbd5e0;
}

.btn-probe:disabled { opacity: 0.5; cursor: not-allowed; }

.probe-error {
  padding: 0.5rem 0.75rem;
  background: #fff5f5;
  color: #c53030;
  border-radius: 6px;
  font-size: 0.8rem;
  margin-bottom: 0.5rem;
}

.lock-toggle {
  background: none;
  border: none;
  font-size: 0.72rem;
  color: #667eea;
  cursor: pointer;
  padding: 0;
  margin-left: 0.375rem;
  font-weight: 400;
}

.lock-toggle:hover { text-decoration: underline; }

.field-locked {
  background: #f7fafc !important;
  color: #718096 !important;
  cursor: default;
}

.duration-display {
  padding: 0.5rem 0.75rem;
  background: #f7fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.9rem;
  color: #4a5568;
  font-variant-numeric: tabular-nums;
}

.rss-preview {
  background: #f8fafc;
}

.preview-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.625rem;
}

.preview-item {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.preview-label {
  font-size: 0.72rem;
  font-family: monospace;
  color: #718096;
  text-transform: lowercase;
}

.preview-value {
  font-size: 0.85rem;
  color: #2d3748;
  word-break: break-all;
}

.form-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  justify-content: flex-end;
  padding-bottom: 2rem;
}

.save-status {
  font-size: 0.875rem;
  font-weight: 500;
  margin-right: auto;
  padding-left: 0.25rem;
}
.save-status.saving { color: #718096; }
.save-status.ok { color: #2f855a; }
.save-status.err { color: #c53030; max-width: 380px; }

.btn-primary {
  padding: 0.6rem 1.25rem;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  text-decoration: none;
  transition: background 0.15s;
}

.btn-primary:hover:not(:disabled) { background: #5a67d8; }

.btn-publish {
  padding: 0.6rem 1.25rem;
  background: #38a169;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-publish:hover:not(:disabled) { background: #2f855a; }

.btn-secondary {
  padding: 0.6rem 1.25rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.9rem;
  cursor: pointer;
  text-decoration: none;
  color: #4a5568;
  transition: all 0.15s;
}

.btn-secondary:hover { background: #f7fafc; }

button:disabled { opacity: 0.6; cursor: not-allowed; }

.success-msg {
  background: #f0fff4;
  border: 1px solid #9ae6b4;
  color: #276749;
  padding: 0.875rem 1rem;
  border-radius: 8px;
  margin-bottom: 1rem;
}

.error-msg {
  background: #fff5f5;
  border: 1px solid #fc8181;
  color: #c53030;
  padding: 0.875rem 1rem;
  border-radius: 8px;
  margin-bottom: 1rem;
}

@media (max-width: 600px) {
  .form-row { flex-direction: column; }
  .preview-grid { grid-template-columns: 1fr; }
}
</style>
