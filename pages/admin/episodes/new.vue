<template>
  <div class="admin-page">
    <AdminNav />
    <div class="container">
      <div class="page-header">
        <h1>New Episode</h1>
        <NuxtLink to="/admin/episodes" class="btn-back">← Back to Episodes</NuxtLink>
      </div>

      <div v-if="successMsg" class="success-msg">{{ successMsg }}</div>
      <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

      <form @submit.prevent="saveEpisode" class="episode-form">
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
            <textarea
              id="description"
              v-model="form.description"
              rows="8"
              placeholder="HTML is supported. Describe your episode, add links, timestamps, etc."
            ></textarea>
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
            Uploading audio… please wait.
          </div>

          <div class="form-row">
            <div class="form-group flex-2">
              <label for="audio_url">Audio URL</label>
              <input
                id="audio_url"
                v-model="form.audio_url"
                type="url"
                placeholder="https://example.com/audio/episode.mp3"
              />
              <p class="hint">Auto-filled after upload, or enter manually.</p>
            </div>
            <div class="form-group">
              <label for="audio_duration">Duration (seconds)</label>
              <input
                id="audio_duration"
                v-model.number="form.audio_duration_seconds"
                type="number"
                min="0"
                placeholder="e.g. 3600"
              />
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
          <NuxtLink to="/admin/episodes" class="btn-secondary">Cancel</NuxtLink>
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

const router = useRouter()
const { createEpisode } = useEpisodes()

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
const uploading = ref(false)
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

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  uploading.value = true
  errorMsg.value = ''

  try {
    const formData = new FormData()
    formData.append('file', file)

    const result = await $fetch<{ url: string; filename: string; size: number }>(
      '/api/upload',
      { method: 'POST', body: formData }
    )

    form.audio_url = result.url
    form.audio_filename = result.filename
    form.audio_size_bytes = result.size
  } catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : 'Upload failed'
  } finally {
    uploading.value = false
  }
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
    await router.push(`/admin/episodes/${episode.id}`)
  } catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : 'Failed to save episode'
  } finally {
    saving.value = false
  }
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
  gap: 0.75rem;
  justify-content: flex-end;
  padding-bottom: 2rem;
}

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
