<template>
  <div class="admin-page">
    <AdminNav :podcast-slug="podcastSlug" />
    <div class="container">
      <h1>People</h1>
      <p class="page-intro">
        Manage hosts, cohosts, and recurring guests. Attach individuals to episodes
        from each episode's edit page. Role and group are frozen at attach time so
        editing a person's defaults doesn't rewrite past episodes' attribution.
      </p>

      <div v-if="successMsg" class="success-msg">{{ successMsg }}</div>
      <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

      <div class="form-section">
        <h2>{{ editingId ? 'Edit person' : 'Add person' }}</h2>
        <form @submit.prevent="savePerson" class="person-form">
          <div class="form-row">
            <div class="form-group flex-2">
              <label for="name">Name <span class="required">*</span></label>
              <input id="name" v-model="form.name" type="text" required placeholder="Jane Doe" />
            </div>
            <div class="form-group">
              <label for="default_role">Default Role</label>
              <input id="default_role" v-model="form.default_role" type="text" placeholder="host" list="role-options" />
              <datalist id="role-options">
                <option value="host" />
                <option value="cohost" />
                <option value="guest" />
                <option value="producer" />
                <option value="editor" />
                <option value="composer" />
              </datalist>
            </div>
            <div class="form-group">
              <label for="default_group">Default Group</label>
              <input id="default_group" v-model="form.default_group" type="text" placeholder="cast" list="group-options" />
              <datalist id="group-options">
                <option value="cast" />
                <option value="crew" />
                <option value="guests" />
              </datalist>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group flex-2">
              <label for="img_url">Photo URL</label>
              <div class="input-with-action">
                <input id="img_url" v-model="form.img_url" type="url" placeholder="https://example.com/jane.jpg" />
                <label class="btn-upload">
                  {{ photoUploading ? `Uploading… ${uploadProgress}%` : 'Upload…' }}
                  <input type="file" accept="image/jpeg,image/png,image/webp"
                    :disabled="photoUploading" @change="handlePhotoChange" hidden />
                </label>
              </div>
              <p v-if="photoError" class="probe-error">{{ photoError }}</p>
              <p class="hint">Square image. Upload + crop to {{ PHOTO_SIZE }}×{{ PHOTO_SIZE }} in-browser, or paste a URL.</p>
            </div>
            <div class="form-group flex-2">
              <label for="href">Profile / Website</label>
              <input id="href" v-model="form.href" type="url" placeholder="https://janedoe.example.com" />
            </div>
          </div>

          <ArtworkCropper
            :open="cropperOpen"
            :src="cropperSrc"
            :filename="cropperFilename"
            :output-size="PHOTO_SIZE"
            @cancel="closeCropper"
            @cropped="onCropperSaved"
          />

          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" v-model="form.auto_attach" />
              Auto-attach to new episodes
            </label>
            <p class="hint">When checked, this person is automatically attached to every new episode at the default role/group above. Use for regular hosts.</p>
          </div>

          <div class="form-actions">
            <button v-if="editingId" type="button" class="btn-secondary" @click="cancelEdit">Cancel</button>
            <button type="submit" class="btn-primary" :disabled="saving">
              {{ saving ? 'Saving…' : editingId ? 'Save changes' : 'Add person' }}
            </button>
          </div>
        </form>
      </div>

      <div class="form-section">
        <h2>Roster</h2>
        <div v-if="loading" class="loading">Loading…</div>
        <div v-else-if="!people.length" class="empty">No people yet. Add hosts and cohosts above.</div>
        <ul v-else class="people-list">
          <li v-for="p in people" :key="p.id" class="person-row">
            <div class="person-avatar">
              <img v-if="p.img_url" :src="p.img_url" :alt="p.name" />
              <span v-else class="avatar-placeholder">{{ p.name.charAt(0).toUpperCase() }}</span>
            </div>
            <div class="person-meta">
              <strong>{{ p.name }}</strong>
              <span class="person-tags">
                <span class="tag">{{ p.default_role }}</span>
                <span class="tag">{{ p.default_group }}</span>
                <span v-if="p.auto_attach" class="tag tag-auto">auto-attach</span>
              </span>
              <a v-if="p.href" :href="p.href" target="_blank" rel="noopener" class="person-link">{{ p.href }}</a>
            </div>
            <div class="person-actions">
              <button class="btn-link" @click="startEdit(p)">Edit</button>
              <button class="btn-link danger" @click="deletePerson(p)">Remove</button>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

interface Person {
  id: number
  podcast_id: number
  name: string
  img_url: string | null
  href: string | null
  default_role: string
  default_group: string
  auto_attach: number
  created_at: string
  updated_at: string
}

const route = useRoute()
const podcastSlug = route.params.slug as string

const people = ref<Person[]>([])
const loading = ref(true)
const saving = ref(false)
const editingId = ref<number | null>(null)
const successMsg = ref('')
const errorMsg = ref('')

// Person photos crop to a smaller square than podcast/episode art — they
// render as avatars in apps and disk is the only cost.
const PHOTO_SIZE = 600

const { uploadProgress, uploadFile } = useUpload(podcastSlug)
const photoUploading = ref(false)
const photoError = ref('')

const cropperOpen = ref(false)
const cropperSrc = ref<string | null>(null)
const cropperFilename = ref('')
let cropperRevokeUrl: string | null = null

function handlePhotoChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  photoError.value = ''
  if (cropperRevokeUrl) URL.revokeObjectURL(cropperRevokeUrl)
  const url = URL.createObjectURL(file)
  cropperRevokeUrl = url
  cropperSrc.value = url
  cropperFilename.value = file.name
  cropperOpen.value = true
  input.value = ''
}

function closeCropper() {
  cropperOpen.value = false
  if (cropperRevokeUrl) {
    URL.revokeObjectURL(cropperRevokeUrl)
    cropperRevokeUrl = null
  }
  cropperSrc.value = null
}

async function onCropperSaved(payload: { blob: Blob; filename: string }) {
  closeCropper()
  photoUploading.value = true
  photoError.value = ''
  try {
    const file = new File([payload.blob], payload.filename, { type: payload.blob.type })
    const result = await uploadFile(file, 'artwork')
    form.img_url = result.url
  } catch (err: unknown) {
    photoError.value = err instanceof Error ? err.message : 'Upload failed'
  } finally {
    photoUploading.value = false
  }
}

const form = reactive({
  name: '',
  img_url: '',
  href: '',
  default_role: 'host',
  default_group: 'cast',
  auto_attach: false,
})

async function loadPeople() {
  loading.value = true
  try {
    people.value = await $fetch<Person[]>(`/api/podcasts/${podcastSlug}/people`)
  } catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : 'Failed to load people'
  } finally {
    loading.value = false
  }
}

await loadPeople()

function resetForm() {
  form.name = ''
  form.img_url = ''
  form.href = ''
  form.default_role = 'host'
  form.default_group = 'cast'
  form.auto_attach = false
  editingId.value = null
}

function startEdit(p: Person) {
  editingId.value = p.id
  form.name = p.name
  form.img_url = p.img_url || ''
  form.href = p.href || ''
  form.default_role = p.default_role
  form.default_group = p.default_group
  form.auto_attach = !!p.auto_attach
  // Scroll the form into view so the user sees what they're editing.
  if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
}

function cancelEdit() {
  resetForm()
}

async function savePerson() {
  saving.value = true
  errorMsg.value = ''
  successMsg.value = ''
  try {
    const body = { ...form }
    if (editingId.value) {
      await $fetch(`/api/podcasts/${podcastSlug}/people/${editingId.value}`, {
        method: 'PATCH',
        body,
      })
      successMsg.value = `Updated ${form.name}.`
    } else {
      await $fetch(`/api/podcasts/${podcastSlug}/people`, {
        method: 'POST',
        body,
      })
      successMsg.value = `Added ${form.name}.`
    }
    resetForm()
    await loadPeople()
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
      || (err instanceof Error ? err.message : 'Failed to save person')
  } finally {
    saving.value = false
    setTimeout(() => { successMsg.value = '' }, 3500)
  }
}

async function deletePerson(p: Person) {
  if (!window.confirm(`Remove ${p.name}? They'll be removed from every episode they're attached to.`)) return
  try {
    await $fetch(`/api/podcasts/${podcastSlug}/people/${p.id}`, { method: 'DELETE' })
    successMsg.value = `Removed ${p.name}.`
    if (editingId.value === p.id) resetForm()
    await loadPeople()
  } catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : 'Failed to remove person'
  }
}

useHead({ title: 'People — Podshelf Admin' })
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

h1 { margin: 0 0 0.5rem; font-size: 1.5rem; color: #1a202c; }

.page-intro {
  margin: 0 0 1.5rem;
  font-size: 0.9rem;
  color: #4a5568;
  line-height: 1.5;
}

.form-section {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
}

.form-section h2 {
  margin: 0 0 1.25rem;
  font-size: 0.95rem;
  font-weight: 600;
  color: #4a5568;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.person-form { display: flex; flex-direction: column; gap: 0.75rem; }

.form-row { display: flex; gap: 1rem; }
.form-row .form-group { flex: 1; }
.form-row .form-group.flex-2 { flex: 2; }

.form-group { margin: 0; }

label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: #4a5568;
  margin-bottom: 0.375rem;
}

.required { color: #e53e3e; }
.hint { font-size: 0.78rem; color: #718096; margin-top: 0.375rem; }

input[type="text"], input[type="url"] {
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
}
input:focus {
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 500;
  cursor: pointer;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.btn-primary {
  padding: 0.5rem 1.1rem;
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
  padding: 0.5rem 1.1rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.875rem;
  cursor: pointer;
  color: #4a5568;
}
.btn-secondary:hover { background: #f7fafc; }

button:disabled { opacity: 0.6; cursor: not-allowed; }

.people-list { list-style: none; margin: 0; padding: 0; }

.person-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  border-bottom: 1px solid #edf2f7;
}
.person-row:last-child { border-bottom: none; }

.person-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  background: #edf2f7;
  display: flex;
  align-items: center;
  justify-content: center;
}
.person-avatar img { width: 100%; height: 100%; object-fit: cover; }
.avatar-placeholder { color: #4a5568; font-weight: 600; }

.person-meta {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}
.person-meta strong { color: #1a202c; }

.person-tags { display: flex; gap: 0.375rem; flex-wrap: wrap; }
.tag {
  font-size: 0.72rem;
  background: #edf2f7;
  color: #4a5568;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
}
.tag-auto { background: #ebf4ff; color: #4c51bf; }

.person-link {
  font-size: 0.78rem;
  color: #667eea;
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.person-link:hover { text-decoration: underline; }

.person-actions { display: flex; gap: 0.5rem; flex-shrink: 0; }

.btn-link {
  background: none;
  border: none;
  color: #667eea;
  cursor: pointer;
  font-size: 0.85rem;
  padding: 0.25rem 0.5rem;
}
.btn-link:hover { text-decoration: underline; }
.btn-link.danger { color: #c53030; }

.empty { color: #718096; padding: 1rem 0; text-align: center; }
.loading { color: #718096; padding: 2rem 0; }

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
.probe-error {
  padding: 0.5rem 0.75rem;
  background: #fff5f5;
  color: #c53030;
  border-radius: 6px;
  font-size: 0.8rem;
  margin: 0.5rem 0 0;
}

@media (max-width: 600px) {
  .form-row { flex-direction: column; gap: 0.75rem; }
  .person-row { flex-wrap: wrap; }
  .person-actions { width: 100%; justify-content: flex-end; }
  .input-with-action { flex-wrap: wrap; }
  .input-with-action input { min-width: 0; flex: 1 1 100%; }
  .input-with-action .btn-upload { flex: 1; justify-content: center; }
}
</style>
