<template>
  <div class="admin-page">
    <AdminNav />
    <div class="container">
      <div class="page-header">
        <h1>Episodes</h1>
        <NuxtLink to="/admin/episodes/new" class="btn-primary">+ New Episode</NuxtLink>
      </div>

      <div v-if="loading" class="loading">Loading episodes…</div>

      <div v-else-if="error" class="error-msg">{{ error }}</div>

      <div v-else-if="!episodes.length" class="empty">
        <p>No episodes yet.</p>
        <NuxtLink to="/admin/episodes/new" class="btn-primary">Create your first episode</NuxtLink>
      </div>

      <table v-else class="episodes-table">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Title</th>
            <th scope="col">Status</th>
            <th scope="col">Published</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="ep in episodes" :key="ep.id">
            <td class="col-num">
              <span v-if="ep.episode_number" class="ep-num">{{ ep.episode_number }}</span>
              <span v-else class="ep-num draft">—</span>
            </td>
            <td class="col-title">
              <NuxtLink :to="`/admin/episodes/${ep.id}`" class="ep-title">
                {{ ep.title }}
              </NuxtLink>
            </td>
            <td class="col-status">
              <span :class="['status-badge', ep.status]">{{ ep.status }}</span>
            </td>
            <td class="col-date">
              {{ ep.published_at ? formatDate(ep.published_at) : '—' }}
            </td>
            <td class="col-actions">
              <NuxtLink :to="`/admin/episodes/${ep.id}`" class="action-btn">Edit</NuxtLink>
              <button @click="confirmDelete(ep)" class="action-btn danger">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Delete confirmation modal -->
    <div v-if="deleteTarget" class="modal-overlay" @click.self="deleteTarget = null">
      <div class="modal">
        <h3>Delete Episode?</h3>
        <p>Are you sure you want to delete <strong>{{ deleteTarget.title }}</strong>? This cannot be undone.</p>
        <div class="modal-actions">
          <button @click="deleteTarget = null" class="btn-secondary">Cancel</button>
          <button @click="doDelete" class="btn-danger" :disabled="deleting">
            {{ deleting ? 'Deleting…' : 'Delete' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Episode } from '~/composables/useEpisodes'

definePageMeta({ middleware: 'admin-auth' })

const { episodes, loading, error, refresh, deleteEpisode } = useEpisodes()
await refresh()

const deleteTarget = ref<Episode | null>(null)
const deleting = ref(false)

function confirmDelete(ep: Episode) {
  deleteTarget.value = ep
}

async function doDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await deleteEpisode(deleteTarget.value.id)
    deleteTarget.value = null
  } finally {
    deleting.value = false
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

useHead({ title: 'Episodes — Podshelf Admin' })
</script>

<style scoped>
* { box-sizing: border-box; }

.admin-page {
  min-height: 100vh;
  background: #f7fafc;
  font-family: system-ui, sans-serif;
}

.container {
  max-width: 960px;
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

.btn-primary {
  display: inline-block;
  padding: 0.5rem 1rem;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-primary:hover {
  background: #5a67d8;
}

.loading, .empty {
  text-align: center;
  color: #718096;
  padding: 3rem;
}

.empty .btn-primary {
  margin-top: 1rem;
}

.error-msg {
  color: #c53030;
  padding: 1rem;
  background: #fff5f5;
  border-radius: 8px;
}

.episodes-table {
  width: 100%;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  border-collapse: collapse;
  overflow: hidden;
}

.episodes-table th {
  background: #f7fafc;
  text-align: left;
  padding: 0.75rem 1rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: #718096;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid #e2e8f0;
}

.episodes-table td {
  padding: 0.875rem 1rem;
  border-bottom: 1px solid #f0f4f8;
  vertical-align: middle;
}

.episodes-table tr:last-child td {
  border-bottom: none;
}

.episodes-table tr:hover td {
  background: #f7fafc;
}

.col-num { width: 60px; }
.col-status { width: 110px; }
.col-date { width: 140px; font-size: 0.85rem; color: #718096; }
.col-actions { width: 140px; }

.ep-num {
  display: inline-block;
  min-width: 28px;
  text-align: center;
  padding: 0.2rem 0.5rem;
  background: #edf2f7;
  border-radius: 4px;
  font-size: 0.8rem;
  font-weight: 600;
  color: #4a5568;
}

.ep-num.draft { color: #a0aec0; }

.ep-title {
  color: #2d3748;
  text-decoration: none;
  font-weight: 500;
}

.ep-title:hover {
  color: #667eea;
  text-decoration: underline;
}

.status-badge {
  display: inline-block;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: capitalize;
}

.status-badge.published {
  background: #c6f6d5;
  color: #276749;
}

.status-badge.draft {
  background: #fef3c7;
  color: #92400e;
}

.action-btn {
  display: inline-block;
  padding: 0.3rem 0.65rem;
  border: 1px solid #e2e8f0;
  border-radius: 5px;
  background: white;
  color: #4a5568;
  font-size: 0.8rem;
  text-decoration: none;
  cursor: pointer;
  margin-right: 0.375rem;
  transition: all 0.15s;
}

.action-btn:hover {
  border-color: #667eea;
  color: #667eea;
}

.action-btn.danger {
  font-family: system-ui, sans-serif;
}

.action-btn.danger:hover {
  border-color: #fc8181;
  color: #c53030;
}

/* Modal */
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

.modal h3 {
  margin: 0 0 0.75rem;
  font-size: 1.1rem;
}

.modal p {
  color: #4a5568;
  font-size: 0.9rem;
  margin: 0 0 1.5rem;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

.btn-secondary {
  padding: 0.5rem 1rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-secondary:hover {
  background: #f7fafc;
}

.btn-danger {
  padding: 0.5rem 1rem;
  background: #e53e3e;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-danger:hover:not(:disabled) {
  background: #c53030;
}

.btn-danger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
