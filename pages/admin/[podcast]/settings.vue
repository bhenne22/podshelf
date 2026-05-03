<template>
  <div class="admin-page">
    <AdminNav :podcast-slug="podcastSlug" />
    <div class="container">
      <h1>Show Settings</h1>

      <div v-if="successMsg" class="success-msg">{{ successMsg }}</div>
      <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

      <div v-if="pending" class="loading">Loading settings…</div>

      <form v-else @submit.prevent="saveSettings" class="settings-form">
        <div class="form-section">
          <h2>Podcast Identity</h2>

          <div class="form-group">
            <label for="title">Show Title <span class="required">*</span></label>
            <input id="title" v-model="form.title" type="text" required placeholder="My Awesome Podcast" />
          </div>

          <div class="form-group">
            <label for="description">Description</label>
            <textarea id="description" v-model="form.description" rows="4"
              placeholder="A brief description of your show for podcast directories and your RSS feed."
            ></textarea>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="author">Author / Host Name</label>
              <input id="author" v-model="form.author" type="text" placeholder="Jane Doe" />
            </div>
            <div class="form-group">
              <label for="email">Contact Email</label>
              <input id="email" v-model="form.email" type="email" placeholder="podcast@example.com" />
              <p class="hint">Used in iTunes owner email field of the RSS feed.</p>
            </div>
          </div>

          <div class="form-group">
            <label for="image_url">Podcast Artwork</label>
            <div v-if="form.image_url" class="artwork-preview">
              <img :src="form.image_url" :alt="form.title || 'Podcast artwork'" class="artwork-thumb" />
              <div class="artwork-meta">
                <a :href="form.image_url" target="_blank" rel="noopener">{{ form.image_url }}</a>
              </div>
              <button type="button" class="btn-secondary btn-clear-artwork" @click="form.image_url = ''">Clear</button>
            </div>
            <div class="input-with-action">
              <input id="image_url" v-model="form.image_url" type="url"
                placeholder="https://example.com/podcast-art.jpg" />
              <label class="btn-upload">
                {{ artworkUploading ? `Uploading… ${uploadProgress}%` : 'Upload…' }}
                <input type="file" accept="image/jpeg,image/png,image/webp"
                  :disabled="artworkUploading" @change="handleArtworkChange" hidden />
              </label>
              <button type="button" class="btn-upload" @click="pickerOpen = true">Pick…</button>
            </div>
            <p v-if="artworkError" class="probe-error">{{ artworkError }}</p>
            <p class="hint">Paste a URL, upload, or pick from the artwork gallery. Must be at least 1400×1400px per Apple Podcasts.</p>
          </div>

          <div class="form-group">
            <label for="website">Show Website</label>
            <input id="website" v-model="form.website" type="url"
              placeholder="https://yourpodcast.example.com" />
            <p class="hint">Public site that hosts the podcast pages — RSS &lt;link&gt; entries point here.</p>
          </div>
        </div>

        <div class="form-section">
          <h2>RSS / Directory Settings</h2>

          <div class="form-row">
            <div class="form-group">
              <label for="language">Language</label>
              <input id="language" v-model="form.language" type="text" placeholder="en" />
              <p class="hint">ISO 639-1 code, e.g. en, es, fr</p>
            </div>
            <div class="form-group">
              <label for="category">iTunes Category</label>
              <select id="category" v-model="form.category">
                <option>Arts</option>
                <option>Business</option>
                <option>Comedy</option>
                <option>Education</option>
                <option>Fiction</option>
                <option>Government</option>
                <option>Health & Fitness</option>
                <option>History</option>
                <option>Kids & Family</option>
                <option>Leisure</option>
                <option>Music</option>
                <option>News</option>
                <option>Religion & Spirituality</option>
                <option>Science</option>
                <option>Society & Culture</option>
                <option>Sports</option>
                <option>Technology</option>
                <option>True Crime</option>
                <option>TV & Film</option>
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="explicit">Explicit Content</label>
              <select id="explicit" v-model="form.explicit">
                <option value="false">No (Clean)</option>
                <option value="true">Yes (Explicit)</option>
              </select>
            </div>
            <div class="form-group">
              <label for="copyright">Copyright</label>
              <input id="copyright" v-model="form.copyright" type="text"
                placeholder="© 2025 Jane Doe" />
            </div>
          </div>

          <div class="form-group">
            <label for="audio_tracking_prefix">Audio Tracking Prefix</label>
            <input id="audio_tracking_prefix" v-model="form.audio_tracking_prefix" type="text"
              placeholder="https://media.blubrry.com/1467354/" />
            <p class="hint">Prepended to episode audio URLs in the RSS feed only (e.g. Blubrry, Chartable, Podtrac). To use Podshelf's built-in tracking, set this to <code>{{ siteUrl }}/track/</code>.</p>
          </div>
        </div>

        <div class="form-actions">
          <span v-if="saving" class="save-status saving">Saving…</span>
          <span v-else-if="justSaved" class="save-status ok">✓ Saved</span>
          <span v-else-if="errorMsg" class="save-status err">✗ {{ errorMsg }}</span>
          <button type="submit" class="btn-primary" :disabled="saving">
            {{ saving ? 'Saving…' : 'Save Settings' }}
          </button>
        </div>
      </form>

      <div v-if="!pending" class="form-section danger-zone">
        <h2>Danger Zone</h2>
        <div v-if="initial?.status === 'inactive'" class="dz-row">
          <div>
            <strong>This podcast is awaiting purge.</strong>
            <p class="hint">The public RSS feed returns 404 while inactive. Restore it below to bring it back, or ask an admin to permanently delete it.</p>
          </div>
          <button type="button" class="btn-restore" :disabled="restoring" @click="restorePodcast">
            {{ restoring ? 'Restoring…' : 'Restore' }}
          </button>
        </div>
        <div v-else class="dz-row">
          <div>
            <strong>Delete podcast</strong>
            <p class="hint">Soft-deletes this podcast. The RSS feed becomes unavailable; episodes are preserved. Any podcast member can restore from the dashboard, or an admin can permanently purge it.</p>
          </div>
          <button type="button" class="btn-danger" :disabled="deleting" @click="confirmDelete">
            {{ deleting ? 'Deleting…' : 'Delete podcast' }}
          </button>
        </div>
      </div>
    </div>

    <ArtworkPicker
      :open="pickerOpen"
      :podcast-slug="podcastSlug"
      @close="pickerOpen = false"
      @select="onArtworkPicked"
    />

    <div v-if="showDeleteConfirm" class="modal-overlay" @click.self="showDeleteConfirm = false">
      <div class="modal">
        <h3>Delete this podcast?</h3>
        <p>
          <strong>{{ form.title }}</strong> will be marked inactive. The public RSS
          feed will return 404 immediately. Episodes are preserved and you can
          restore the podcast from the dashboard until an admin purges it.
        </p>
        <div class="modal-actions">
          <button class="btn-secondary" @click="showDeleteConfirm = false">Cancel</button>
          <button class="btn-danger" :disabled="deleting" @click="doDelete">
            {{ deleting ? 'Deleting…' : 'Soft-delete' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'admin-auth' })

const route = useRoute()
const podcastSlug = route.params.podcast as string
const config = useRuntimeConfig()
const siteUrl = config.public.siteUrl || 'http://localhost:3000'

interface PodcastRow {
  title: string
  description: string | null
  author: string | null
  email: string | null
  image_url: string | null
  language: string | null
  copyright: string | null
  category: string | null
  explicit: string | null
  website: string | null
  audio_tracking_prefix: string | null
  status: string
  deleted_at: string | null
}

const { data: initial, pending } = await useFetch<PodcastRow>(`/api/podcasts/${podcastSlug}`)

const form = reactive({
  title: '',
  description: '',
  author: '',
  email: '',
  image_url: '',
  language: 'en',
  copyright: '',
  category: 'Society & Culture',
  explicit: 'false',
  website: '',
  audio_tracking_prefix: '',
})

const saving = ref(false)
const justSaved = ref(false)
const successMsg = ref('')
const errorMsg = ref('')

const { uploading: artworkUploading, uploadProgress, uploadFile } = useUpload(podcastSlug)
const artworkError = ref('')

async function handleArtworkChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  artworkError.value = ''
  try {
    const result = await uploadFile(file, 'artwork')
    form.image_url = result.url
  } catch (err: unknown) {
    artworkError.value = err instanceof Error ? err.message : 'Artwork upload failed'
  } finally {
    input.value = ''
  }
}

const showDeleteConfirm = ref(false)
const deleting = ref(false)
const restoring = ref(false)

function confirmDelete() {
  showDeleteConfirm.value = true
}

async function doDelete() {
  deleting.value = true
  try {
    await $fetch(`/api/podcasts/${podcastSlug}`, { method: 'DELETE' })
    showDeleteConfirm.value = false
    await navigateTo('/admin')
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Failed to delete'
  } finally {
    deleting.value = false
  }
}

async function restorePodcast() {
  restoring.value = true
  try {
    await $fetch(`/api/podcasts/${podcastSlug}/restore`, { method: 'POST' })
    successMsg.value = 'Podcast restored.'
    if (initial.value) initial.value.status = 'active'
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Failed to restore'
  } finally {
    restoring.value = false
  }
}

const pickerOpen = ref(false)
function onArtworkPicked(payload: { url: string; name: string }) {
  form.image_url = payload.url
}

watch(initial, (p) => {
  if (!p) return
  form.title = p.title || ''
  form.description = p.description || ''
  form.author = p.author || ''
  form.email = p.email || ''
  form.image_url = p.image_url || ''
  form.language = p.language || 'en'
  form.copyright = p.copyright || ''
  form.category = p.category || 'Society & Culture'
  form.explicit = p.explicit || 'false'
  form.website = p.website || ''
  form.audio_tracking_prefix = p.audio_tracking_prefix || ''
}, { immediate: true })

async function saveSettings() {
  saving.value = true
  errorMsg.value = ''
  successMsg.value = ''

  try {
    await $fetch(`/api/podcasts/${podcastSlug}`, {
      method: 'PATCH',
      body: { ...form },
    })
    successMsg.value = 'Settings saved successfully.'
    justSaved.value = true
    setTimeout(() => { justSaved.value = false }, 3500)
  } catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : 'Failed to save settings'
  } finally {
    saving.value = false
  }
}

useHead({ title: 'Settings — Podshelf Admin' })
</script>

<style scoped>
* { box-sizing: border-box; }

.admin-page {
  min-height: 100vh;
  background: #f7fafc;
  font-family: system-ui, sans-serif;
}

.container {
  max-width: 760px;
  margin: 0 auto;
  padding: 2rem 1.25rem;
}

h1 {
  margin: 0 0 1.5rem;
  font-size: 1.5rem;
  color: #1a202c;
}

.settings-form {
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

label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: #4a5568;
  margin-bottom: 0.375rem;
}
.required { color: #e53e3e; }
.hint { font-size: 0.78rem; color: #718096; margin-top: 0.375rem; }
.hint code {
  background: #edf2f7;
  padding: 0.1em 0.35em;
  border-radius: 3px;
  font-size: 0.85em;
}

input[type="text"],
input[type="url"],
input[type="email"],
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

.input-with-action {
  display: flex;
  gap: 0.5rem;
}
.input-with-action input { flex: 1; }
.btn-upload {
  display: inline-flex;
  align-items: center;
  padding: 0.5rem 0.875rem;
  background: #edf2f7;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 500;
  color: #4a5568;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}
.btn-upload:hover { background: #e2e8f0; border-color: #cbd5e0; }

.artwork-preview {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 0.75rem;
  background: #f7fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  margin-bottom: 0.5rem;
}
.artwork-thumb {
  width: 72px;
  height: 72px;
  object-fit: cover;
  border-radius: 6px;
  background: #edf2f7;
  flex-shrink: 0;
}
.artwork-meta {
  flex: 1;
  font-size: 0.85rem;
  word-break: break-all;
}
.artwork-meta a { color: #667eea; }
.btn-secondary.btn-clear-artwork {
  flex-shrink: 0;
  padding: 0.4rem 0.75rem;
  font-size: 0.8rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  cursor: pointer;
  color: #4a5568;
}
.btn-secondary.btn-clear-artwork:hover { background: #f7fafc; }
.probe-error {
  padding: 0.5rem 0.75rem;
  background: #fff5f5;
  color: #c53030;
  border-radius: 6px;
  font-size: 0.8rem;
  margin-top: 0.5rem;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 0.75rem;
  padding-bottom: 2rem;
}

.save-status {
  font-size: 0.875rem;
  font-weight: 500;
}
.save-status.saving { color: #718096; }
.save-status.ok { color: #2f855a; }
.save-status.err { color: #c53030; max-width: 380px; }

.btn-primary {
  padding: 0.6rem 1.5rem;
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
button:disabled { opacity: 0.6; cursor: not-allowed; }

.danger-zone {
  border-color: #fed7d7;
  background: #fffaf0;
}
.danger-zone h2 { color: #c53030; }
.dz-row {
  display: flex;
  gap: 1.25rem;
  align-items: center;
  justify-content: space-between;
}
.dz-row > div { flex: 1; }
.dz-row strong { color: #2d3748; font-size: 0.95rem; }
.btn-danger {
  flex-shrink: 0;
  padding: 0.55rem 1.1rem;
  background: #e53e3e;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-danger:hover:not(:disabled) { background: #c53030; }

.btn-restore {
  flex-shrink: 0;
  padding: 0.55rem 1.1rem;
  background: #ebf4ff;
  border: 1px solid #c3dafe;
  color: #4c51bf;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
}
.btn-restore:hover:not(:disabled) { background: #c3dafe; }

.btn-secondary {
  padding: 0.5rem 1rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.875rem;
  cursor: pointer;
  color: #4a5568;
  transition: all 0.15s;
}
.btn-secondary:hover { background: #f7fafc; }

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
.modal p { color: #4a5568; font-size: 0.9rem; margin: 0 0 1.5rem; }
.modal-actions { display: flex; gap: 0.75rem; justify-content: flex-end; }

@media (max-width: 720px) {
  .container { padding: 1rem 0.75rem; }
  .form-section { padding: 1rem; }
  /* 16px input font prevents iOS Safari from zooming on focus. */
  input[type="text"],
  input[type="url"],
  input[type="email"],
  select,
  textarea {
    font-size: 16px;
    padding: 0.625rem 0.75rem;
    min-height: 44px;
  }
  textarea { min-height: auto; }
  .form-actions .btn-primary { min-height: 44px; }
  .input-with-action {
    flex-wrap: wrap;
  }
  .input-with-action input { min-width: 0; flex: 1 1 100%; }
  .input-with-action .btn-upload { flex: 1; justify-content: center; }
  .artwork-preview {
    flex-wrap: wrap;
  }
  .artwork-meta { flex-basis: 100%; order: 3; }
  .dz-row {
    flex-direction: column;
    align-items: stretch;
    gap: 0.875rem;
  }
  .dz-row .btn-danger,
  .dz-row .btn-restore {
    align-self: stretch;
  }
  .modal {
    padding: 1.25rem;
    max-height: 86vh;
    overflow-y: auto;
  }
  .modal-actions { flex-direction: column-reverse; }
  .modal-actions button { width: 100%; }
}

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
