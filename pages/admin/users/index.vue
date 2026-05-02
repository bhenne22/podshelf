<template>
  <div class="admin-page">
    <AdminNav />
    <div class="container">
      <div class="page-header">
        <h1>Users</h1>
        <button class="btn-primary" @click="showCreate = true">+ New User</button>
      </div>

      <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

      <div v-if="pending" class="loading">Loading…</div>
      <table v-else class="user-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Admin</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td>{{ u.email }}</td>
            <td>{{ u.is_admin ? 'Yes' : 'No' }}</td>
            <td class="dim">{{ formatDate(u.created_at) }}</td>
            <td>
              <button class="action-btn" @click="resetPassword(u)">Reset password</button>
              <button class="action-btn" @click="toggleAdmin(u)">{{ u.is_admin ? 'Demote' : 'Promote' }}</button>
              <button v-if="me && u.id !== me.id" class="action-btn danger" @click="confirmDelete(u)">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Create user modal -->
    <div v-if="showCreate" class="modal-overlay" @click.self="showCreate = false">
      <div class="modal">
        <h3>Create User</h3>
        <div class="form-group">
          <label>Email</label>
          <input v-model="newUser.email" type="email" placeholder="user@example.com" />
        </div>
        <div class="form-group">
          <label>Password</label>
          <input v-model="newUser.password" type="password" placeholder="min 8 chars" />
        </div>
        <div class="form-group">
          <label class="checkbox">
            <input v-model="newUser.is_admin" type="checkbox" /> Admin
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" @click="showCreate = false">Cancel</button>
          <button class="btn-primary" :disabled="creating" @click="doCreate">
            {{ creating ? 'Creating…' : 'Create' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Reset password modal -->
    <div v-if="resetTarget" class="modal-overlay" @click.self="resetTarget = null">
      <div class="modal">
        <h3>Reset Password — {{ resetTarget.email }}</h3>
        <div class="form-group">
          <label>New Password</label>
          <input v-model="newPassword" type="password" placeholder="min 8 chars" />
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" @click="resetTarget = null">Cancel</button>
          <button class="btn-primary" :disabled="resetting" @click="doReset">
            {{ resetting ? 'Saving…' : 'Reset' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Delete confirmation -->
    <div v-if="deleteTarget" class="modal-overlay" @click.self="deleteTarget = null">
      <div class="modal">
        <h3>Delete user?</h3>
        <p>Delete <strong>{{ deleteTarget.email }}</strong>? This removes all of their podcast access. This cannot be undone.</p>
        <div class="modal-actions">
          <button class="btn-secondary" @click="deleteTarget = null">Cancel</button>
          <button class="btn-danger" :disabled="deleting" @click="doDelete">
            {{ deleting ? 'Deleting…' : 'Delete' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'admin-auth' })

interface User {
  id: number
  email: string
  is_admin: number
  created_at: string
  updated_at: string
}
interface Me { id: number; email: string; is_admin: boolean }

const { data: me } = await useFetch<Me>('/api/me')
const { data: users, refresh, pending } = await useFetch<User[]>('/api/users')

const errorMsg = ref('')

const showCreate = ref(false)
const creating = ref(false)
const newUser = reactive({ email: '', password: '', is_admin: false })

const resetTarget = ref<User | null>(null)
const resetting = ref(false)
const newPassword = ref('')

const deleteTarget = ref<User | null>(null)
const deleting = ref(false)

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString()
}

async function doCreate() {
  creating.value = true
  errorMsg.value = ''
  try {
    await $fetch('/api/users', { method: 'POST', body: { ...newUser } })
    showCreate.value = false
    Object.assign(newUser, { email: '', password: '', is_admin: false })
    await refresh()
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Failed to create user'
  } finally {
    creating.value = false
  }
}

async function toggleAdmin(u: User) {
  errorMsg.value = ''
  try {
    await $fetch(`/api/users/${u.id}`, { method: 'PATCH', body: { is_admin: !u.is_admin } })
    await refresh()
  } catch {
    errorMsg.value = 'Failed to update user'
  }
}

function resetPassword(u: User) {
  resetTarget.value = u
  newPassword.value = ''
}

async function doReset() {
  if (!resetTarget.value) return
  resetting.value = true
  errorMsg.value = ''
  try {
    await $fetch(`/api/users/${resetTarget.value.id}`, {
      method: 'PATCH',
      body: { password: newPassword.value },
    })
    resetTarget.value = null
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Failed to reset password'
  } finally {
    resetting.value = false
  }
}

function confirmDelete(u: User) { deleteTarget.value = u }

async function doDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  errorMsg.value = ''
  try {
    await $fetch(`/api/users/${deleteTarget.value.id}`, { method: 'DELETE' })
    deleteTarget.value = null
    await refresh()
  } catch {
    errorMsg.value = 'Failed to delete user'
  } finally {
    deleting.value = false
  }
}

useHead({ title: 'Users — Podshelf Admin' })
</script>

<style scoped>
* { box-sizing: border-box; }
.admin-page { min-height: 100vh; background: #f7fafc; font-family: system-ui, sans-serif; }
.container { max-width: 900px; margin: 0 auto; padding: 2rem 1.25rem; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
h1 { margin: 0; font-size: 1.5rem; color: #1a202c; }

.btn-primary {
  padding: 0.5rem 1rem;
  background: #667eea; color: white;
  border: none; border-radius: 6px;
  font-size: 0.875rem; font-weight: 500; cursor: pointer;
}
.btn-primary:hover:not(:disabled) { background: #5a67d8; }
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

.btn-secondary {
  padding: 0.5rem 1rem;
  background: white; color: #4a5568;
  border: 1px solid #e2e8f0; border-radius: 6px;
  font-size: 0.875rem; cursor: pointer;
}

.btn-danger {
  padding: 0.5rem 1rem;
  background: #e53e3e; color: white;
  border: none; border-radius: 6px;
  font-size: 0.875rem; font-weight: 500; cursor: pointer;
}
.btn-danger:hover:not(:disabled) { background: #c53030; }
.btn-danger:disabled { opacity: 0.6; cursor: not-allowed; }

.loading { color: #718096; padding: 2rem 0; text-align: center; }

.user-table {
  width: 100%;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  border-collapse: collapse;
  overflow: hidden;
}
.user-table th {
  background: #f7fafc; text-align: left;
  padding: 0.75rem 1rem; font-size: 0.75rem;
  font-weight: 600; color: #718096;
  text-transform: uppercase; letter-spacing: 0.05em;
  border-bottom: 1px solid #e2e8f0;
}
.user-table td { padding: 0.875rem 1rem; border-bottom: 1px solid #f0f4f8; }
.user-table tr:last-child td { border-bottom: none; }
.dim { color: #718096; font-size: 0.85rem; }

.action-btn {
  padding: 0.3rem 0.65rem;
  border: 1px solid #e2e8f0; border-radius: 5px;
  background: white; color: #4a5568;
  font-size: 0.8rem; cursor: pointer; margin-right: 0.375rem;
}
.action-btn:hover { border-color: #667eea; color: #667eea; }
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
.form-group label { display: block; font-size: 0.875rem; font-weight: 500; color: #4a5568; margin-bottom: 0.375rem; }
.form-group label.checkbox { display: flex; align-items: center; gap: 0.5rem; font-weight: normal; }
.form-group input[type="email"], .form-group input[type="password"] {
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
