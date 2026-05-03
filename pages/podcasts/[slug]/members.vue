<template>
  <div class="admin-page">
    <AdminNav :podcast-slug="podcastSlug" />
    <div class="container">
      <div class="page-header">
        <h1>Members</h1>
        <button v-if="me?.is_admin" class="btn-primary" @click="showAdd = true">+ Grant Access</button>
      </div>

      <p class="hint">Users in this list can manage episodes and settings for this podcast. Admins always have access.</p>

      <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

      <table v-if="members && members.length" class="member-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Admin</th>
            <th>Added</th>
            <th v-if="me?.is_admin">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in members" :key="m.id">
            <td>{{ m.email }}</td>
            <td>{{ m.is_admin ? 'Yes' : 'No' }}</td>
            <td class="dim">{{ formatDate(m.created_at) }}</td>
            <td v-if="me?.is_admin">
              <button class="action-btn danger" @click="confirmRemove(m)">Remove</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">No members yet.</p>
    </div>

    <!-- Add member modal -->
    <div v-if="showAdd" class="modal-overlay" @click.self="showAdd = false">
      <div class="modal">
        <h3>Grant Access</h3>
        <div class="form-group">
          <label>User Email</label>
          <input v-model="addEmail" type="email" placeholder="user@example.com" />
          <p class="hint">User must already exist. Create them under Users first.</p>
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" @click="showAdd = false">Cancel</button>
          <button class="btn-primary" :disabled="adding" @click="doAdd">
            {{ adding ? 'Adding…' : 'Add' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Remove confirmation -->
    <div v-if="removeTarget" class="modal-overlay" @click.self="removeTarget = null">
      <div class="modal">
        <h3>Remove member?</h3>
        <p>Remove <strong>{{ removeTarget.email }}</strong> from this podcast?</p>
        <div class="modal-actions">
          <button class="btn-secondary" @click="removeTarget = null">Cancel</button>
          <button class="btn-danger" :disabled="removing" @click="doRemove">
            {{ removing ? 'Removing…' : 'Remove' }}
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

interface Member {
  id: number
  email: string
  is_admin: number
  created_at: string
}
interface Me { id: number; email: string; is_admin: boolean }

const { data: me } = await useFetch<Me>('/api/me')
const { data: members, refresh } = await useFetch<Member[]>(`/api/podcasts/${podcastSlug}/members`)

const errorMsg = ref('')
const showAdd = ref(false)
const adding = ref(false)
const addEmail = ref('')

const removeTarget = ref<Member | null>(null)
const removing = ref(false)

function formatDate(iso: string) { return new Date(iso).toLocaleDateString() }

async function doAdd() {
  adding.value = true
  errorMsg.value = ''
  try {
    await $fetch(`/api/podcasts/${podcastSlug}/members`, {
      method: 'POST',
      body: { email: addEmail.value },
    })
    showAdd.value = false
    addEmail.value = ''
    await refresh()
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Failed to grant access'
  } finally {
    adding.value = false
  }
}

function confirmRemove(m: Member) { removeTarget.value = m }

async function doRemove() {
  if (!removeTarget.value) return
  removing.value = true
  errorMsg.value = ''
  try {
    await $fetch(`/api/podcasts/${podcastSlug}/members/${removeTarget.value.id}`, { method: 'DELETE' })
    removeTarget.value = null
    await refresh()
  } catch {
    errorMsg.value = 'Failed to remove member'
  } finally {
    removing.value = false
  }
}

useHead({ title: 'Members — Podshelf Admin' })
</script>

<style scoped>
* { box-sizing: border-box; }
.admin-page { min-height: 100vh; background: #f7fafc; font-family: system-ui, sans-serif; }
.container { max-width: 900px; margin: 0 auto; padding: 2rem 1.25rem; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
h1 { margin: 0; font-size: 1.5rem; color: #1a202c; }
.hint { font-size: 0.85rem; color: #718096; margin-bottom: 1.5rem; }

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
.btn-danger {
  padding: 0.5rem 1rem; background: #e53e3e; color: white;
  border: none; border-radius: 6px;
  font-size: 0.875rem; font-weight: 500; cursor: pointer;
}
.btn-danger:hover:not(:disabled) { background: #c53030; }
.btn-danger:disabled { opacity: 0.6; cursor: not-allowed; }

.member-table {
  width: 100%;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  border-collapse: collapse;
  overflow: hidden;
}
.member-table th {
  background: #f7fafc; text-align: left;
  padding: 0.75rem 1rem; font-size: 0.75rem;
  font-weight: 600; color: #718096;
  text-transform: uppercase; letter-spacing: 0.05em;
}
.member-table td { padding: 0.875rem 1rem; border-bottom: 1px solid #f0f4f8; }
.member-table tr:last-child td { border-bottom: none; }
.dim { color: #718096; font-size: 0.85rem; }
.empty { padding: 2rem; text-align: center; color: #718096; }

.action-btn {
  padding: 0.3rem 0.65rem;
  border: 1px solid #e2e8f0; border-radius: 5px;
  background: white; color: #4a5568;
  font-size: 0.8rem; cursor: pointer;
}
.action-btn.danger:hover { border-color: #fc8181; color: #c53030; }

.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
}
.modal {
  background: white; border-radius: 10px;
  padding: 1.75rem; max-width: 460px; width: 90%;
}
.modal h3 { margin: 0 0 1rem; font-size: 1.05rem; }
.form-group { margin-bottom: 1rem; }
.form-group label {
  display: block; font-size: 0.875rem; font-weight: 500;
  color: #4a5568; margin-bottom: 0.375rem;
}
.form-group input {
  display: block; width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid #e2e8f0; border-radius: 6px;
  font-size: 0.9rem;
}
.modal-actions { display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem; }

.error-msg {
  background: #fff5f5; border: 1px solid #fc8181;
  color: #c53030; padding: 0.875rem 1rem;
  border-radius: 8px; margin-bottom: 1rem; font-size: 0.9rem;
}
</style>
