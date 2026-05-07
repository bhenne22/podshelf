<template>
  <div class="admin-page">
    <AdminNav :podcast-slug="podcastSlug" />
    <div class="container">
      <h1>Distribution</h1>
      <p class="page-intro">
        Track every platform this podcast is published to — Apple, Spotify, Pocket Casts,
        whatever. Free-form: add anything. The list is exposed via the API
        (<code>GET /api/podcasts/{{ podcastSlug }}/distribution</code>) so a static-site
        build can render a "Listen on" block. Not surfaced in the RSS feed.
      </p>

      <div v-if="successMsg" class="success-msg">{{ successMsg }}</div>
      <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

      <div class="form-section">
        <h2>{{ editingId ? 'Edit destination' : 'Add destination' }}</h2>

        <div v-if="!editingId" class="presets">
          <span class="presets-label">Quick add:</span>
          <button
            v-for="p in PRESETS"
            :key="p"
            type="button"
            class="preset-chip"
            @click="form.name = p"
          >{{ p }}</button>
        </div>

        <form @submit.prevent="saveDistribution" class="dist-form">
          <div class="form-row">
            <div class="form-group flex-2">
              <label for="name">Name <span class="required">*</span></label>
              <input id="name" v-model="form.name" type="text" required placeholder="Apple Podcasts" />
            </div>
            <div class="form-group flex-2">
              <label for="url">Listing URL</label>
              <input id="url" v-model="form.url" type="url" placeholder="https://podcasts.apple.com/…" />
            </div>
          </div>

          <div class="form-group">
            <label for="platform_id">Platform ID</label>
            <input id="platform_id" v-model="form.platform_id" type="text" placeholder='e.g. Apple show ID, Spotify URI, "spotify:show:abc123"' />
            <p class="hint">Optional. Whatever ID the platform uses to identify this show — handy if the listing URL ever changes.</p>
          </div>

          <div class="form-group">
            <label for="notes">Notes</label>
            <textarea id="notes" v-model="form.notes" rows="3" placeholder="How to log into the dashboard, support contact, submission status, etc." />
            <p class="hint">Free-form. Most platforms are one-time setup — leave a trail for future-you.</p>
          </div>

          <div class="form-actions">
            <button v-if="editingId" type="button" class="btn-secondary" @click="cancelEdit">Cancel</button>
            <button type="submit" class="btn-primary" :disabled="saving">
              {{ saving ? 'Saving…' : editingId ? 'Save changes' : 'Add destination' }}
            </button>
          </div>
        </form>
      </div>

      <div class="form-section">
        <h2>Destinations <span v-if="distributions.length" class="count">({{ distributions.length }})</span></h2>
        <div v-if="loading" class="loading">Loading…</div>
        <div v-else-if="!distributions.length" class="empty">
          No destinations yet. Add one above — Apple, Spotify, Pocket Casts, anywhere this podcast lives.
        </div>
        <ul v-else class="dist-list">
          <li v-for="(d, i) in distributions" :key="d.id" class="dist-row" :class="{ 'is-editing': editingId === d.id }">
            <div class="dist-order">
              <button
                type="button"
                class="order-btn"
                :disabled="i === 0 || reordering"
                @click="moveUp(i)"
                title="Move up"
              >▲</button>
              <button
                type="button"
                class="order-btn"
                :disabled="i === distributions.length - 1 || reordering"
                @click="moveDown(i)"
                title="Move down"
              >▼</button>
            </div>
            <div class="dist-meta">
              <strong class="dist-name">{{ d.name }}</strong>
              <a v-if="d.url" :href="d.url" target="_blank" rel="noopener" class="dist-url">{{ d.url }}</a>
              <span v-if="d.platform_id" class="dist-platform-id">ID: {{ d.platform_id }}</span>
              <p v-if="d.notes" class="dist-notes">{{ d.notes }}</p>
            </div>
            <div class="dist-actions">
              <button type="button" class="btn-link" @click="startEdit(d)">Edit</button>
              <button type="button" class="btn-link danger" @click="confirmDelete(d)">Delete</button>
            </div>
          </li>
        </ul>
      </div>
    </div>

    <div v-if="deleteTarget" class="modal-overlay" @click.self="deleteTarget = null">
      <div class="modal">
        <h3>Remove destination?</h3>
        <p>Remove <strong>{{ deleteTarget.name }}</strong> from the distribution list?</p>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" @click="deleteTarget = null">Cancel</button>
          <button type="button" class="btn-danger" :disabled="deleting" @click="doDelete">
            {{ deleting ? 'Removing…' : 'Remove' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

interface Distribution {
  id: number
  podcast_id: number
  name: string
  url: string | null
  platform_id: string | null
  notes: string | null
  position: number
  created_at: string
  updated_at: string
}

const PRESETS = [
  'Apple Podcasts',
  'Spotify',
  'Amazon Music',
  'YouTube Music',
  'Pocket Casts',
  'Overcast',
  'Castro',
  'Castbox',
  'iHeartRadio',
  'Podcast Index',
]

const route = useRoute()
const podcastSlug = route.params.slug as string

const distributions = ref<Distribution[]>([])
const loading = ref(true)
const saving = ref(false)
const reordering = ref(false)
const editingId = ref<number | null>(null)
const errorMsg = ref('')
const successMsg = ref('')

const form = reactive({
  name: '',
  url: '',
  platform_id: '',
  notes: '',
})

const deleteTarget = ref<Distribution | null>(null)
const deleting = ref(false)

async function load() {
  loading.value = true
  try {
    distributions.value = await $fetch<Distribution[]>(`/api/podcasts/${podcastSlug}/distribution`)
  } catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : 'Failed to load distributions'
  } finally {
    loading.value = false
  }
}
await load()

function flashSuccess(msg: string) {
  successMsg.value = msg
  setTimeout(() => { if (successMsg.value === msg) successMsg.value = '' }, 3000)
}

function resetForm() {
  form.name = ''
  form.url = ''
  form.platform_id = ''
  form.notes = ''
  editingId.value = null
}

function startEdit(d: Distribution) {
  editingId.value = d.id
  form.name = d.name
  form.url = d.url || ''
  form.platform_id = d.platform_id || ''
  form.notes = d.notes || ''
  if (typeof window !== 'undefined') {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
}

function cancelEdit() {
  resetForm()
}

async function saveDistribution() {
  saving.value = true
  errorMsg.value = ''
  try {
    const body = {
      name: form.name.trim(),
      url: form.url.trim() || null,
      platform_id: form.platform_id.trim() || null,
      notes: form.notes.trim() || null,
    }
    if (editingId.value) {
      await $fetch(`/api/podcasts/${podcastSlug}/distribution/${editingId.value}`, {
        method: 'PATCH',
        body,
      })
      flashSuccess(`Updated "${body.name}".`)
    } else {
      await $fetch(`/api/podcasts/${podcastSlug}/distribution`, {
        method: 'POST',
        body,
      })
      flashSuccess(`Added "${body.name}".`)
    }
    resetForm()
    await load()
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
      || (err instanceof Error ? err.message : 'Save failed')
  } finally {
    saving.value = false
  }
}

function confirmDelete(d: Distribution) {
  deleteTarget.value = d
}

async function doDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  errorMsg.value = ''
  try {
    await $fetch(`/api/podcasts/${podcastSlug}/distribution/${deleteTarget.value.id}`, { method: 'DELETE' })
    flashSuccess(`Removed "${deleteTarget.value.name}".`)
    if (editingId.value === deleteTarget.value.id) resetForm()
    deleteTarget.value = null
    await load()
  } catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : 'Delete failed'
  } finally {
    deleting.value = false
  }
}

async function reorder(newOrder: Distribution[]) {
  reordering.value = true
  errorMsg.value = ''
  // Optimistic — show the new order while the request is in flight.
  const previous = distributions.value
  distributions.value = newOrder
  try {
    await $fetch(`/api/podcasts/${podcastSlug}/distribution/reorder`, {
      method: 'POST',
      body: { ids: newOrder.map((d) => d.id) },
    })
  } catch (err: unknown) {
    distributions.value = previous
    errorMsg.value = err instanceof Error ? err.message : 'Reorder failed'
  } finally {
    reordering.value = false
  }
}

function moveUp(i: number) {
  if (i <= 0) return
  const next = distributions.value.slice()
  ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
  reorder(next)
}

function moveDown(i: number) {
  if (i >= distributions.value.length - 1) return
  const next = distributions.value.slice()
  ;[next[i], next[i + 1]] = [next[i + 1], next[i]]
  reorder(next)
}

useHead({ title: 'Distribution — Podshelf Admin' })
</script>

<style scoped>
* { box-sizing: border-box; }

.admin-page {
  min-height: 100vh;
  background: #f7fafc;
  font-family: system-ui, sans-serif;
}

.container {
  max-width: 880px;
  margin: 0 auto;
  padding: 2rem 1.25rem;
}

h1 {
  margin: 0 0 0.5rem;
  font-size: 1.5rem;
  color: #1a202c;
}

.page-intro {
  color: #4a5568;
  font-size: 0.9rem;
  margin: 0 0 1.5rem;
  line-height: 1.5;
}

.page-intro code {
  background: #edf2f7;
  padding: 0.1em 0.35em;
  border-radius: 3px;
  font-size: 0.85em;
}

.form-section {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
}

.form-section h2 {
  margin: 0 0 1rem;
  font-size: 0.95rem;
  font-weight: 600;
  color: #4a5568;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.count {
  font-size: 0.85rem;
  color: #a0aec0;
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
  margin-left: 0.25rem;
}

.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 1rem;
  align-items: center;
}
.presets-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #718096;
  margin-right: 0.25rem;
}
.preset-chip {
  background: #ebf4ff;
  border: 1px solid #c3dafe;
  color: #4c51bf;
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: background 0.15s;
}
.preset-chip:hover { background: #c3dafe; }

.form-row { display: flex; gap: 1rem; }
.form-row .form-group { flex: 1; }
.form-row .form-group.flex-2 { flex: 2; }

.form-group { margin-bottom: 1rem; }
.form-group:last-of-type { margin-bottom: 0; }

label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: #4a5568;
  margin-bottom: 0.375rem;
}
.required { color: #e53e3e; }
.hint {
  font-size: 0.78rem;
  color: #718096;
  margin: 0.4rem 0 0;
}

input[type="text"],
input[type="url"],
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
input:focus, textarea:focus {
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
}
textarea { resize: vertical; line-height: 1.5; }

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 1.25rem;
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
  transition: background 0.15s;
}
.btn-primary:hover:not(:disabled) { background: #5a67d8; }
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

.btn-secondary {
  padding: 0.55rem 1.1rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.875rem;
  cursor: pointer;
  color: #4a5568;
  transition: all 0.15s;
}
.btn-secondary:hover { background: #f7fafc; }

.dist-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.dist-row {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.75rem 0.875rem;
  background: #f7fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}
.dist-row.is-editing {
  border-color: #c3dafe;
  background: #ebf4ff;
}

.dist-order {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  flex-shrink: 0;
  padding-top: 0.1rem;
}

.order-btn {
  background: white;
  border: 1px solid #e2e8f0;
  color: #4a5568;
  width: 24px;
  height: 22px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.7rem;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}
.order-btn:hover:not(:disabled) {
  border-color: #667eea;
  color: #667eea;
}
.order-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.dist-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.dist-name {
  color: #1a202c;
  font-size: 0.95rem;
}
.dist-url {
  color: #667eea;
  font-size: 0.82rem;
  word-break: break-all;
}
.dist-platform-id {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.78rem;
  color: #718096;
}
.dist-notes {
  margin: 0.3rem 0 0;
  font-size: 0.85rem;
  color: #4a5568;
  white-space: pre-wrap;
  line-height: 1.45;
}

.dist-actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

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
.loading, .empty {
  color: #718096;
  padding: 1rem 0.25rem;
  font-size: 0.9rem;
}

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
  max-width: 420px;
  width: 90%;
}
.modal h3 { margin: 0 0 0.75rem; font-size: 1.1rem; }
.modal p { color: #4a5568; font-size: 0.9rem; margin: 0 0 1.5rem; }
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}
.btn-danger {
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
.btn-danger:disabled { opacity: 0.6; cursor: not-allowed; }

@media (max-width: 720px) {
  .container { padding: 1rem 0.75rem; }
  .form-section { padding: 1rem; }
  .form-row { flex-direction: column; gap: 0; }
  /* 16px input font prevents iOS Safari from zooming on focus. */
  input[type="text"], input[type="url"], textarea {
    font-size: 16px;
    padding: 0.625rem 0.75rem;
    min-height: 44px;
  }
  textarea { min-height: auto; }
  .dist-row {
    flex-wrap: wrap;
  }
  .dist-actions {
    width: 100%;
    justify-content: flex-end;
    border-top: 1px solid #e2e8f0;
    padding-top: 0.5rem;
    margin-top: 0.25rem;
  }
}
</style>
