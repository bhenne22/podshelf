<template>
  <div class="admin-page">
    <AdminNav />
    <div class="container">
      <div class="page-header">
        <h1>API Keys</h1>
        <button class="btn-primary" @click="showCreate = true">+ New Key</button>
      </div>

      <p class="hint">
        API keys let you (or services like Claude or OpenClaw) call the Podshelf API
        on your behalf. Send the key in the <code>X-Api-Key</code> header or as
        <code>Authorization: Bearer &lt;key&gt;</code>. Disabled or expired keys are
        rejected at the auth layer.
      </p>

      <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

      <!-- Plaintext shown once after creation -->
      <div v-if="newKey" class="new-key-card">
        <h3>New key created — copy it now</h3>
        <p>This is the only time you'll see the full key. After leaving this page, only the label and metadata remain.</p>
        <div class="key-display">
          <code>{{ newKey }}</code>
          <button class="btn-copy" @click="copyKey">{{ copied ? 'Copied' : 'Copy' }}</button>
        </div>
        <button class="btn-secondary" @click="newKey = ''; copied = false">Done</button>
      </div>

      <div v-if="pending && !keys" class="loading">Loading…</div>
      <div v-else-if="keys && keys.length" class="table-wrap"><table class="key-table">
        <thead>
          <tr>
            <th>Label</th>
            <th>Permissions</th>
            <th>Scope</th>
            <th>Status</th>
            <th>Expires</th>
            <th>Last used</th>
            <th class="col-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="k in keys" :key="k.id" :class="{ 'row-disabled': k.disabled || isExpired(k) }">
            <td class="col-label">{{ k.label }}</td>
            <td class="col-perm" data-label="Permissions">
              <span :class="['perm-badge', `perm-${k.permissions}`]">{{ k.permissions }}</span>
            </td>
            <td class="col-scope" data-label="Scope">
              <span v-if="!k.podcast_slugs" class="scope-all">All my podcasts</span>
              <template v-else>
                <span v-for="slug in k.podcast_slugs" :key="slug" class="scope-badge">{{ slug }}</span>
              </template>
            </td>
            <td class="col-status" data-label="Status">
              <span v-if="k.disabled" class="status disabled">Disabled</span>
              <span v-else-if="isExpired(k)" class="status expired">Expired</span>
              <span v-else class="status active">Active</span>
            </td>
            <td class="col-expires" data-label="Expires">{{ k.expires_at ? formatDate(k.expires_at) : '—' }}</td>
            <td class="col-lastused dim" data-label="Last used">{{ k.last_used_at ? formatRelative(k.last_used_at) : 'never' }}</td>
            <td class="col-actions">
              <button class="action-btn" @click="openEdit(k)">Edit</button>
              <button class="action-btn" @click="toggleDisabled(k)">
                {{ k.disabled ? 'Enable' : 'Disable' }}
              </button>
              <button class="action-btn danger" @click="confirmRevoke(k)">Revoke</button>
            </td>
          </tr>
        </tbody>
      </table></div>
      <p v-else class="empty">No API keys yet. Create one to use the API non-interactively.</p>
    </div>

    <!-- Create modal -->
    <div v-if="showCreate" class="modal-overlay" @click.self="closeCreate">
      <div class="modal modal-wide">
        <h3>New API Key</h3>
        <div class="form-group">
          <label>Label</label>
          <input v-model="createLabel" type="text" placeholder="Claude, OpenClaw, dev-laptop, …" autofocus />
          <p class="hint">A name for you to recognize this key. Use one key per consumer so you can revoke individually.</p>
        </div>
        <div class="form-group">
          <label>Expires <span class="hint">(optional — leave blank for no expiration)</span></label>
          <input v-model="createExpiresAt" type="datetime-local" />
        </div>
        <div class="form-group">
          <label>Permissions</label>
          <select v-model="createPermissions">
            <option value="full">Full — read, write, delete</option>
            <option value="write">Write — read &amp; write, no delete</option>
            <option value="read">Read-only — GET requests only</option>
          </select>
        </div>
        <div class="form-group">
          <label>Podcast scope</label>
          <div class="radio-row">
            <label class="radio">
              <input type="radio" v-model="createScopeMode" value="all" /> All my podcasts
            </label>
            <label class="radio">
              <input type="radio" v-model="createScopeMode" value="restricted" /> Restrict to specific podcasts
            </label>
          </div>
          <div v-if="createScopeMode === 'restricted'" class="podcast-checklist">
            <p v-if="!podcasts || !podcasts.length" class="hint">You don't have access to any podcasts yet.</p>
            <label v-for="p in podcasts" :key="p.slug" class="checkbox-row">
              <input type="checkbox" :value="p.slug" v-model="createSelectedSlugs" />
              <span class="checkbox-label">{{ p.title }} <code>/{{ p.slug }}</code></span>
            </label>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" @click="closeCreate">Cancel</button>
          <button class="btn-primary" :disabled="creating" @click="doCreate">
            {{ creating ? 'Creating…' : 'Create Key' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Edit modal: label + expiration + scope -->
    <div v-if="editTarget" class="modal-overlay" @click.self="editTarget = null">
      <div class="modal modal-wide">
        <h3>Edit — {{ editTarget.label }}</h3>
        <div class="form-group">
          <label>Label</label>
          <input v-model="editLabel" type="text" />
        </div>
        <div class="form-group">
          <label>Expires <span class="hint">(empty = no expiration)</span></label>
          <input v-model="editExpiresAt" type="datetime-local" />
        </div>
        <div class="form-group">
          <label>Permissions</label>
          <select v-model="editPermissions">
            <option value="full">Full — read, write, delete</option>
            <option value="write">Write — read &amp; write, no delete</option>
            <option value="read">Read-only — GET requests only</option>
          </select>
        </div>
        <div class="form-group">
          <label>Podcast scope</label>
          <div class="radio-row">
            <label class="radio">
              <input type="radio" v-model="editScopeMode" value="all" /> All my podcasts
            </label>
            <label class="radio">
              <input type="radio" v-model="editScopeMode" value="restricted" /> Restrict to specific podcasts
            </label>
          </div>
          <div v-if="editScopeMode === 'restricted'" class="podcast-checklist">
            <p v-if="!podcasts || !podcasts.length" class="hint">You don't have access to any podcasts yet.</p>
            <label v-for="p in podcasts" :key="p.slug" class="checkbox-row">
              <input type="checkbox" :value="p.slug" v-model="editSelectedSlugs" />
              <span class="checkbox-label">{{ p.title }} <code>/{{ p.slug }}</code></span>
            </label>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" @click="editTarget = null">Cancel</button>
          <button class="btn-primary" :disabled="savingEdit" @click="saveEdit">
            {{ savingEdit ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Revoke confirmation -->
    <div v-if="revokeTarget" class="modal-overlay" @click.self="revokeTarget = null">
      <div class="modal">
        <h3>Revoke key?</h3>
        <p>Revoking <strong>{{ revokeTarget.label }}</strong> permanently deletes it. Anything using it will start getting 401s. This cannot be undone.</p>
        <div class="modal-actions">
          <button class="btn-secondary" @click="revokeTarget = null">Cancel</button>
          <button class="btn-danger" :disabled="revoking" @click="doRevoke">
            {{ revoking ? 'Revoking…' : 'Revoke' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

type Permissions = 'read' | 'write' | 'full'

interface ApiKey {
  id: number
  label: string
  expires_at: string | null
  disabled: number
  permissions: Permissions
  created_at: string
  last_used_at: string | null
  podcast_slugs: string[] | null
}

interface PodcastSummary {
  slug: string
  title: string
}

const { data: keys, refresh, pending } = await useFetch<ApiKey[]>('/api/me/api-keys')
const { data: podcasts } = await useFetch<PodcastSummary[]>('/api/podcasts')

const errorMsg = ref('')
const newKey = ref('')
const copied = ref(false)

const showCreate = ref(false)
const creating = ref(false)
const createLabel = ref('')
const createExpiresAt = ref('')
const createPermissions = ref<Permissions>('full')
const createScopeMode = ref<'all' | 'restricted'>('all')
const createSelectedSlugs = ref<string[]>([])

const editTarget = ref<ApiKey | null>(null)
const editLabel = ref('')
const editExpiresAt = ref('')
const editPermissions = ref<Permissions>('full')
const editScopeMode = ref<'all' | 'restricted'>('all')
const editSelectedSlugs = ref<string[]>([])
const savingEdit = ref(false)

const revokeTarget = ref<ApiKey | null>(null)
const revoking = ref(false)

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatRelative(iso: string) {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const d = Math.floor(hr / 24)
  if (d < 30) return `${d}d ago`
  return formatDate(iso)
}

function isExpired(k: ApiKey) {
  return !!(k.expires_at && new Date(k.expires_at).getTime() <= Date.now())
}

function closeCreate() {
  showCreate.value = false
  createLabel.value = ''
  createExpiresAt.value = ''
  createPermissions.value = 'full'
  createScopeMode.value = 'all'
  createSelectedSlugs.value = []
}

async function doCreate() {
  creating.value = true
  errorMsg.value = ''
  try {
    const body: Record<string, unknown> = {
      label: createLabel.value,
      permissions: createPermissions.value,
    }
    if (createExpiresAt.value) {
      body.expires_at = new Date(createExpiresAt.value).toISOString()
    }
    if (createScopeMode.value === 'restricted') {
      if (!createSelectedSlugs.value.length) {
        throw new Error('Pick at least one podcast or choose "All my podcasts".')
      }
      body.podcast_slugs = createSelectedSlugs.value
    }
    const created = await $fetch<ApiKey & { key: string }>('/api/me/api-keys', {
      method: 'POST',
      body,
    })
    newKey.value = created.key
    copied.value = false
    closeCreate()
    await refresh()
  } catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string }; message?: string }
    errorMsg.value = e?.data?.statusMessage || e?.message || 'Failed to create key'
  } finally {
    creating.value = false
  }
}

function isoToDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function openEdit(k: ApiKey) {
  editTarget.value = k
  editLabel.value = k.label
  editExpiresAt.value = k.expires_at ? isoToDatetimeLocal(k.expires_at) : ''
  editPermissions.value = k.permissions
  if (k.podcast_slugs && k.podcast_slugs.length) {
    editScopeMode.value = 'restricted'
    editSelectedSlugs.value = [...k.podcast_slugs]
  } else {
    editScopeMode.value = 'all'
    editSelectedSlugs.value = []
  }
}

async function saveEdit() {
  if (!editTarget.value) return
  savingEdit.value = true
  errorMsg.value = ''
  try {
    const label = editLabel.value.trim()
    if (!label) throw new Error('Label cannot be empty.')

    let podcast_slugs: string[] | null
    if (editScopeMode.value === 'restricted') {
      if (!editSelectedSlugs.value.length) {
        throw new Error('Pick at least one podcast or choose "All my podcasts".')
      }
      podcast_slugs = editSelectedSlugs.value
    } else {
      podcast_slugs = null
    }

    const body: Record<string, unknown> = {
      label,
      permissions: editPermissions.value,
      podcast_slugs,
      expires_at: editExpiresAt.value ? new Date(editExpiresAt.value).toISOString() : null,
    }

    await $fetch(`/api/me/api-keys/${editTarget.value.id}`, {
      method: 'PATCH',
      body,
    })
    editTarget.value = null
    await refresh()
  } catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string }; message?: string }
    errorMsg.value = e?.data?.statusMessage || e?.message || 'Failed to update key'
  } finally {
    savingEdit.value = false
  }
}

async function copyKey() {
  try {
    await navigator.clipboard.writeText(newKey.value)
    copied.value = true
  } catch {
    copied.value = false
  }
}

async function toggleDisabled(k: ApiKey) {
  errorMsg.value = ''
  try {
    await $fetch(`/api/me/api-keys/${k.id}`, {
      method: 'PATCH',
      body: { disabled: !k.disabled },
    })
    await refresh()
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Update failed'
  }
}

function confirmRevoke(k: ApiKey) { revokeTarget.value = k }

async function doRevoke() {
  if (!revokeTarget.value) return
  revoking.value = true
  errorMsg.value = ''
  try {
    await $fetch(`/api/me/api-keys/${revokeTarget.value.id}`, { method: 'DELETE' })
    revokeTarget.value = null
    await refresh()
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Failed to revoke'
  } finally {
    revoking.value = false
  }
}

useHead({ title: 'API Keys — Podshelf Admin' })
</script>

<style scoped>
* { box-sizing: border-box; }
.admin-page { min-height: 100vh; background: #f7fafc; font-family: system-ui, sans-serif; }
.container { max-width: 920px; margin: 0 auto; padding: 2rem 1.25rem; }

.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
h1 { margin: 0; font-size: 1.5rem; color: #1a202c; }
.hint { font-size: 0.85rem; color: #718096; margin-bottom: 1.5rem; line-height: 1.5; }
.hint code {
  background: #edf2f7;
  padding: 0.1em 0.35em;
  border-radius: 3px;
  font-family: ui-monospace, monospace;
  font-size: 0.85em;
}

.btn-primary {
  padding: 0.5rem 1rem; background: #667eea; color: white;
  border: none; border-radius: 6px;
  font-size: 0.875rem; font-weight: 500; cursor: pointer;
}
.btn-primary:hover:not(:disabled) { background: #5a67d8; }
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

.btn-secondary {
  padding: 0.5rem 1rem; background: white; color: #4a5568;
  border: 1px solid #e2e8f0; border-radius: 6px;
  font-size: 0.875rem; cursor: pointer;
}
.btn-secondary:hover { background: #f7fafc; }

.btn-danger {
  padding: 0.5rem 1rem; background: #e53e3e; color: white;
  border: none; border-radius: 6px;
  font-size: 0.875rem; font-weight: 500; cursor: pointer;
}
.btn-danger:hover:not(:disabled) { background: #c53030; }
.btn-danger:disabled { opacity: 0.6; cursor: not-allowed; }

.loading, .empty { padding: 2rem; text-align: center; color: #718096; }

.new-key-card {
  background: #fffbeb;
  border: 1px solid #f6e05e;
  border-radius: 10px;
  padding: 1.25rem 1.5rem;
  margin-bottom: 1.5rem;
}
.new-key-card h3 { margin: 0 0 0.5rem; color: #744210; font-size: 1rem; }
.new-key-card p { margin: 0 0 0.75rem; color: #744210; font-size: 0.875rem; }
.key-display {
  display: flex; align-items: center; gap: 0.5rem;
  background: white; border: 1px solid #e2e8f0;
  border-radius: 6px; padding: 0.5rem 0.75rem;
  margin-bottom: 0.75rem;
}
.key-display code {
  flex: 1;
  font-family: ui-monospace, monospace;
  font-size: 0.85rem;
  color: #2d3748;
  word-break: break-all;
}
.btn-copy {
  padding: 0.35rem 0.7rem;
  background: #edf2f7;
  border: 1px solid #e2e8f0;
  border-radius: 5px;
  font-size: 0.8rem;
  cursor: pointer;
  white-space: nowrap;
}
.btn-copy:hover { background: #e2e8f0; }

.key-table {
  width: 100%;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  border-collapse: collapse;
  overflow: hidden;
}
.key-table th {
  background: #f7fafc; text-align: left;
  padding: 0.75rem 1rem; font-size: 0.75rem;
  font-weight: 600; color: #718096;
  text-transform: uppercase; letter-spacing: 0.05em;
}
.key-table td {
  padding: 0.875rem 1rem;
  border-bottom: 1px solid #f0f4f8;
  vertical-align: middle;
  font-size: 0.9rem;
}
.key-table tr:last-child td { border-bottom: none; }
.row-disabled { opacity: 0.55; }
.col-actions { width: 200px; }
.dim { color: #718096; font-size: 0.85rem; }

.status {
  display: inline-block;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.status.active { background: #c6f6d5; color: #276749; }
.status.disabled { background: #edf2f7; color: #718096; }
.status.expired { background: #fed7d7; color: #c53030; }

.action-btn {
  padding: 0.3rem 0.65rem;
  border: 1px solid #e2e8f0; border-radius: 5px;
  background: white; color: #4a5568;
  font-size: 0.8rem; cursor: pointer;
  margin-right: 0.375rem;
}
.action-btn:hover { border-color: #667eea; color: #667eea; }
.action-btn.danger:hover { border-color: #fc8181; color: #c53030; }

.error-msg {
  background: #fff5f5; border: 1px solid #fc8181;
  color: #c53030; padding: 0.875rem 1rem;
  border-radius: 8px; margin-bottom: 1rem; font-size: 0.9rem;
}

.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
}
.modal {
  background: white; border-radius: 10px;
  padding: 1.75rem; max-width: 480px; width: 90%;
  max-height: 85vh;
  overflow-y: auto;
}
.modal-wide { max-width: 540px; }

.perm-badge {
  display: inline-block;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.perm-full { background: #c6f6d5; color: #276749; }
.perm-write { background: #fef3c7; color: #92400e; }
.perm-read { background: #ebf4ff; color: #4c51bf; }

.col-scope { max-width: 280px; }
.scope-all {
  font-size: 0.78rem;
  color: #2f855a;
  background: #f0fff4;
  border: 1px solid #c6f6d5;
  border-radius: 999px;
  padding: 0.15rem 0.55rem;
  display: inline-block;
}
.scope-badge {
  display: inline-block;
  margin: 0.1rem 0.2rem 0.1rem 0;
  padding: 0.15rem 0.5rem;
  background: #ebf4ff;
  border: 1px solid #c3dafe;
  color: #4c51bf;
  border-radius: 999px;
  font-size: 0.78rem;
  font-family: ui-monospace, monospace;
}

.radio-row {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-top: 0.25rem;
}
.radio {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: normal;
  font-size: 0.9rem;
  cursor: pointer;
}

.podcast-checklist {
  margin-top: 0.6rem;
  padding: 0.6rem 0.8rem;
  background: #f7fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  max-height: 180px;
  overflow-y: auto;
}
.checkbox-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0;
  font-size: 0.875rem;
  cursor: pointer;
}
.checkbox-label code {
  background: #edf2f7;
  padding: 0.05em 0.35em;
  border-radius: 3px;
  font-size: 0.85em;
  color: #4c51bf;
}
.modal h3 { margin: 0 0 1rem; font-size: 1.05rem; }
.form-group { margin-bottom: 1rem; }
.form-group label {
  display: block; font-size: 0.875rem; font-weight: 500;
  color: #4a5568; margin-bottom: 0.375rem;
}
.form-group .hint { font-weight: normal; margin: 0; display: inline; }
.form-group input,
.form-group select {
  display: block; width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid #e2e8f0; border-radius: 6px;
  font-size: 0.9rem;
  font-family: inherit;
  background: white;
}
.form-group input:focus,
.form-group select:focus {
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102,126,234,0.15);
  outline: none;
}
.form-group .hint + br + input,
.form-group input + p.hint { margin-top: 0.4rem; }
.modal-actions { display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem; }

.table-wrap {
  width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  border-radius: 10px;
}

@media (max-width: 720px) {
  .container { padding: 1rem 0.75rem; }
  .page-header {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }
  .page-header .btn-primary {
    text-align: center;
    min-height: 44px;
    padding: 0.6rem 1rem;
  }
  .key-table { min-width: 880px; }
  .key-table th,
  .key-table td { padding: 0.5rem 0.625rem; font-size: 0.85rem; }
  .action-btn { padding: 0.5rem 0.625rem; min-height: 38px; }
  /* 16px input font prevents iOS Safari from zooming on focus. */
  .form-group input,
  .form-group select {
    font-size: 16px;
    padding: 0.625rem 0.75rem;
    min-height: 44px;
  }
  /* Pin native checkbox/radio size — on iOS/Android they balloon at the
     larger label font without an explicit dimension. The desktop
     `.form-group input` rule also sets display:block / width:100%, which
     forces a line break on mobile; explicit inline-block + vertical-align
     keeps the control inline with its label text. */
  .form-group input[type="checkbox"],
  .form-group input[type="radio"] {
    display: inline-block;
    width: 18px;
    height: 18px;
    min-height: 0;
    padding: 0;
    margin: 0;
    border: 0;
    background: none;
    flex-shrink: 0;
    vertical-align: middle;
  }
  /* Bump the input/label gap so the podcast name doesn't sit flush against
     the checkbox in the restrict-scope list. */
  .checkbox-row,
  .radio { gap: 0.65rem; }
  .modal {
    padding: 1.25rem;
    max-height: 86vh;
  }
  .modal-actions { flex-direction: column-reverse; }
  .modal-actions button {
    width: 100%;
    min-height: 44px;
  }
  .key-display { flex-wrap: wrap; }
  .key-display code { flex: 1 1 100%; }
  .btn-copy { min-height: 38px; padding: 0.55rem 0.875rem; }
}

@media (max-width: 520px) {
  /* Card layout for API keys: label on top, then chips and labelled
     metadata, then action buttons. */
  .table-wrap { overflow-x: visible; border-radius: 0; }
  .key-table {
    display: block;
    min-width: 0;
    border: none;
    background: transparent;
    overflow: visible;
  }
  .key-table thead { display: none; }
  .key-table tbody { display: block; }
  .key-table tr {
    display: flex;
    flex-direction: column;
    background: white;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    margin-bottom: 0.625rem;
    padding: 0.875rem 1rem;
  }
  .key-table tr:last-child td { border-bottom: none; }
  .key-table td {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0;
    border-bottom: none;
    width: auto;
    min-width: 0;
    font-size: 0.85rem;
  }
  .key-table td[data-label]::before {
    content: attr(data-label);
    color: #a0aec0;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
    width: 84px;
    flex-shrink: 0;
  }
  .col-label {
    order: 1;
    padding: 0 0 0.5rem;
    margin-bottom: 0.5rem;
    border-bottom: 1px solid #f0f4f8;
    font-size: 1rem;
    font-weight: 600;
    word-break: break-word;
  }
  .col-status { order: 2; }
  .col-perm { order: 3; }
  .col-scope { order: 4; align-items: flex-start; max-width: none; }
  .col-scope::before { padding-top: 0.2rem; }
  .col-scope .scope-badge,
  .col-scope .scope-all { margin: 0.1rem 0.2rem 0.1rem 0; }
  .col-expires { order: 5; }
  .col-lastused { order: 6; }
  .col-actions {
    order: 7;
    flex-direction: column;
    gap: 0.5rem;
    padding-top: 0.625rem;
    margin-top: 0.5rem;
    border-top: 1px solid #f0f4f8;
    width: auto;
  }
  .col-actions .action-btn {
    width: 100%;
    text-align: center;
    padding: 0.625rem 0.75rem;
    font-size: 0.85rem;
    min-height: 40px;
    margin-right: 0;
  }
  .new-key-card { padding: 1rem; }
  .key-display { flex-wrap: wrap; }
  .key-display code {
    flex: 1 1 100%;
    font-size: 0.78rem;
  }
  /* In the create/edit modals, the radio + checklist groups need to stack
     a bit tighter so the modal fits. */
  .podcast-checklist { max-height: 200px; }
}
</style>
