<template>
  <div class="admin-page">
    <AdminNav />
    <div class="container">
      <div class="page-header">
        <h1>Edit Episode</h1>
        <div class="header-actions">
          <NuxtLink
            v-if="form.slug"
            :to="`/episodes/${form.slug}`"
            target="_blank"
            class="btn-preview"
          >
            Preview ↗
          </NuxtLink>
          <NuxtLink to="/admin/episodes" class="btn-back">← Episodes</NuxtLink>
        </div>
      </div>

      <div v-if="loadError" class="error-msg">{{ loadError }}</div>
      <div v-if="successMsg" class="success-msg">{{ successMsg }}</div>
      <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

      <div v-if="pending" class="loading">Loading episode…</div>

      <template v-else-if="form.title !== undefined">
        <!-- Publish toggle banner -->
        <div :class="['publish-banner', form.status]">
          <span>
            Status: <strong>{{ form.status === 'published' ? 'Published' : 'Draft' }}</strong>
            <span v-if="form.status === 'published' && form.published_at">
              on {{ formatDate(form.published_at) }}
            </span>
          </span>
          <button
            v-if="form.status === 'draft'"
            @click="togglePublish"
            class="btn-publish-toggle"
            :disabled="saving"
          >
            Publish Now
          </button>
          <button
            v-else
            @click="togglePublish"
            class="btn-unpublish-toggle"
            :disabled="saving"
          >
            Revert to Draft
          </button>
        </div>

        <form @submit.prevent="saveEpisode" class="episode-form">
          <div class="form-section">
            <h2>Basic Info</h2>
            <div class="form-row">
              <div class="form-group flex-2">
                <label for="title">Title <span class="required">*</span></label>
                <input id="title" v-model="form.title" type="text" required />
              </div>
              <div class="form-group">
                <label for="episode_number">Episode #</label>
                <input id="episode_number" v-model.number="form.episode_number" type="number" min="1" />
              </div>
              <div class="form-group">
                <label for="season_number">Season #</label>
                <input id="season_number" v-model.number="form.season_number" type="number" min="1" />
              </div>
            </div>

            <div class="form-group">
              <label for="slug">
                Slug
                <span class="hint">/episodes/<em>{{ form.slug }}</em></span>
              </label>
              <input id="slug" v-model="form.slug" type="text" />
            </div>

            <div class="form-group">
              <label for="description">Show Notes / Description</label>
              <textarea id="description" v-model="form.description" rows="10"></textarea>
            </div>

            <div class="form-group">
              <label for="tags">Tags</label>
              <input id="tags" v-model="form.tags" type="text" placeholder="comma-separated" />
            </div>
          </div>

          <div class="form-section">
            <h2>Audio</h2>
            <div class="form-group">
              <label for="audio_file">Replace Audio File</label>
              <input
                id="audio_file"
                type="file"
                accept="audio/*"
                @change="handleFileChange"
                class="file-input"
              />
            </div>

            <div v-if="uploading" class="upload-progress">Uploading audio…</div>

            <div v-if="form.audio_url" class="current-audio">
              <strong>Current:</strong>
              <a :href="form.audio_url" target="_blank" rel="noopener">{{ form.audio_filename || form.audio_url }}</a>
            </div>

            <div class="form-row">
              <div class="form-group flex-2">
                <label for="audio_url">Audio URL</label>
                <input id="audio_url" v-model="form.audio_url" type="url" />
              </div>
              <div class="form-group">
                <label for="audio_duration">Duration (seconds)</label>
                <input id="audio_duration" v-model.number="form.audio_duration_seconds" type="number" min="0" />
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
                <input id="published_at" v-model="form.published_at" type="datetime-local" />
              </div>
            </div>
          </div>

          <div class="form-actions">
            <NuxtLink to="/admin/episodes" class="btn-secondary">Cancel</NuxtLink>
            <button type="submit" class="btn-primary" :disabled="saving">
              {{ saving ? 'Saving…' : 'Save Changes' }}
            </button>
          </div>
        </form>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Episode } from '~/composables/useEpisodes'

definePageMeta({ middleware: 'admin-auth' })

const route = useRoute()
const id = Number(route.params.id)
const { updateEpisode } = useEpisodes()

const pending = ref(true)
const saving = ref(false)
const uploading = ref(false)
const loadError = ref('')
const errorMsg = ref('')
const successMsg = ref('')

interface EpisodeForm {
  title: string
  slug: string
  episode_number: number | null
  season_number: number | null
  description: string
  audio_url: string
  audio_filename: string
  audio_size_bytes: number | null
  audio_duration_seconds: number | null
  published_at: string
  status: string
  tags: string
  transcript_path: string
}

const form = reactive<EpisodeForm>({
  title: '',
  slug: '',
  episode_number: null,
  season_number: null,
  description: '',
  audio_url: '',
  audio_filename: '',
  audio_size_bytes: null,
  audio_duration_seconds: null,
  published_at: '',
  status: 'draft',
  tags: '',
  transcript_path: '',
})

// Load episode
onMounted(async () => {
  try {
    const episodes = await $fetch<Episode[]>('/api/episodes')
    const ep = episodes.find((e) => e.id === id)
    if (!ep) {
      loadError.value = 'Episode not found.'
      return
    }
    Object.assign(form, {
      title: ep.title,
      slug: ep.slug,
      episode_number: ep.episode_number,
      season_number: ep.season_number,
      description: ep.description || '',
      audio_url: ep.audio_url || '',
      audio_filename: ep.audio_filename || '',
      audio_size_bytes: ep.audio_size_bytes,
      audio_duration_seconds: ep.audio_duration_seconds,
      published_at: ep.published_at ? ep.published_at.slice(0, 16) : '',
      status: ep.status,
      tags: ep.tags || '',
      transcript_path: ep.transcript_path || '',
    })
  } catch (err: unknown) {
    loadError.value = err instanceof Error ? err.message : 'Failed to load episode'
  } finally {
    pending.value = false
  }
})

async function saveEpisode() {
  saving.value = true
  errorMsg.value = ''
  successMsg.value = ''

  try {
    await updateEpisode(id, {
      ...form,
      episode_number: form.episode_number || null,
      season_number: form.season_number || null,
      audio_size_bytes: form.audio_size_bytes || null,
      audio_duration_seconds: form.audio_duration_seconds || null,
      published_at: form.published_at || null,
    })
    successMsg.value = 'Episode saved successfully.'
  } catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : 'Failed to save episode'
  } finally {
    saving.value = false
  }
}

async function togglePublish() {
  if (form.status === 'draft') {
    form.status = 'published'
    if (!form.published_at) {
      form.published_at = new Date().toISOString().slice(0, 16)
    }
  } else {
    form.status = 'draft'
  }
  await saveEpisode()
}

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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
}

useHead({ title: () => `Edit: ${form.title || '…'} — Podshelf Admin` })
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

h1 { margin: 0; font-size: 1.5rem; color: #1a202c; }

.header-actions { display: flex; gap: 0.75rem; align-items: center; }

.btn-back, .btn-preview {
  font-size: 0.875rem;
  color: #667eea;
  text-decoration: none;
}
.btn-back:hover, .btn-preview:hover { text-decoration: underline; }

.publish-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.875rem 1.25rem;
  border-radius: 8px;
  margin-bottom: 1.25rem;
  font-size: 0.9rem;
}
.publish-banner.published {
  background: #f0fff4;
  border: 1px solid #9ae6b4;
  color: #276749;
}
.publish-banner.draft {
  background: #fffff0;
  border: 1px solid #faf089;
  color: #744210;
}

.btn-publish-toggle {
  padding: 0.4rem 0.875rem;
  background: #38a169;
  color: white;
  border: none;
  border-radius: 5px;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-publish-toggle:hover:not(:disabled) { background: #2f855a; }

.btn-unpublish-toggle {
  padding: 0.4rem 0.875rem;
  background: white;
  color: #c53030;
  border: 1px solid #fc8181;
  border-radius: 5px;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-unpublish-toggle:hover:not(:disabled) { background: #fff5f5; }

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

.form-group { margin-bottom: 1rem; }
.form-group:last-child { margin-bottom: 0; }

.form-row { display: flex; gap: 1rem; }
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
.hint { font-size: 0.78rem; color: #718096; margin-left: 0.5rem; font-weight: 400; }

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
  outline: none;
  transition: border-color 0.15s;
}
input:focus, select:focus, textarea:focus {
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
}
textarea { resize: vertical; line-height: 1.6; }
.file-input { padding: 0.375rem; background: #f7fafc; }

.upload-progress {
  padding: 0.75rem 1rem;
  background: #ebf8ff;
  color: #2b6cb0;
  border-radius: 6px;
  font-size: 0.875rem;
  margin-bottom: 1rem;
}

.current-audio {
  font-size: 0.85rem;
  color: #4a5568;
  margin-bottom: 1rem;
  padding: 0.5rem 0.75rem;
  background: #f7fafc;
  border-radius: 5px;
}
.current-audio a { color: #667eea; word-break: break-all; }

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
  transition: background 0.15s;
}
.btn-primary:hover:not(:disabled) { background: #5a67d8; }

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
  font-size: 0.9rem;
}
.error-msg {
  background: #fff5f5;
  border: 1px solid #fc8181;
  color: #c53030;
  padding: 0.875rem 1rem;
  border-radius: 8px;
  margin-bottom: 1rem;
  font-size: 0.9rem;
}
.loading { color: #718096; padding: 2rem 0; }

@media (max-width: 600px) {
  .form-row { flex-direction: column; }
}
</style>
