<template>
  <div class="admin-page">
    <AdminNav />
    <div class="container">
      <div class="page-header">
        <h1>Networks</h1>
        <button class="btn-primary" @click="showCreate = true">+ New Network</button>
      </div>

      <p class="page-intro">
        Networks group sibling podcasts so members of any one of them can see read-only scheduling intent across
        the others. Membership is implicit — a host who's in any podcast in a network sees that network's
        upcoming-episodes view. Edit access is never widened.
      </p>

      <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

      <div v-if="pending" class="loading">Loading…</div>
      <div v-else-if="!networks || !networks.length" class="empty">
        No networks yet. Create one to start coordinating sibling shows.
      </div>
      <div v-else class="table-wrap">
        <table class="network-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Slug</th>
              <th>Podcasts</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="n in networks" :key="n.id">
              <td class="col-title">
                <NuxtLink :to="`/admin/networks/${n.id}`">{{ n.title }}</NuxtLink>
                <div v-if="n.description" class="dim">{{ n.description }}</div>
              </td>
              <td class="mono">/{{ n.slug }}</td>
              <td>
                <span class="count-badge" :class="{ zero: n.podcast_count === 0 }">
                  {{ n.podcast_count }}
                </span>
              </td>
              <td class="dim">{{ formatDate(n.created_at) }}</td>
              <td class="col-actions">
                <NuxtLink :to="`/admin/networks/${n.id}`" class="btn-link">Manage</NuxtLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="showCreate" class="modal-overlay" @click.self="showCreate = false">
      <div class="modal">
        <h3>Create Network</h3>
        <div class="form-group">
          <label>Title</label>
          <input v-model="newNet.title" type="text" placeholder="e.g. Team Puma Knife" />
        </div>
        <div class="form-group">
          <label>Slug</label>
          <input v-model="newNet.slug" type="text" placeholder="Auto-derived from title if blank" />
          <p class="hint">Used in URLs: /networks/<em>slug</em>. Must not collide with any podcast slug.</p>
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea v-model="newNet.description" rows="3" placeholder="Optional — what this network is for" />
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" @click="showCreate = false">Cancel</button>
          <button class="btn-primary" :disabled="creating" @click="doCreate">
            {{ creating ? 'Creating…' : 'Create' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'admin-only' })

interface NetworkRow {
  id: number
  slug: string
  title: string
  description: string | null
  created_at: string
  updated_at: string
  podcast_count: number
}

const { data: networks, pending, refresh } = await useFetch<NetworkRow[]>('/api/admin/networks')

const errorMsg = ref('')

const showCreate = ref(false)
const creating = ref(false)
const newNet = reactive({ title: '', slug: '', description: '' })

async function doCreate() {
  if (!newNet.title.trim()) {
    errorMsg.value = 'Title is required'
    return
  }
  creating.value = true
  errorMsg.value = ''
  try {
    await $fetch('/api/admin/networks', {
      method: 'POST',
      body: {
        title: newNet.title.trim(),
        slug: newNet.slug.trim() || undefined,
        description: newNet.description.trim() || undefined,
      },
    })
    showCreate.value = false
    newNet.title = ''
    newNet.slug = ''
    newNet.description = ''
    await refresh()
  } catch (err: unknown) {
    errorMsg.value =
      (err as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Failed to create network'
  } finally {
    creating.value = false
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString()
}

useHead({ title: 'Networks — Podshelf Admin' })
</script>

<style scoped>
* { box-sizing: border-box; }
.admin-page { min-height: 100vh; background: #f7fafc; font-family: system-ui, sans-serif; }
.container { max-width: 900px; margin: 0 auto; padding: 2rem 1.25rem; }
.page-header {
  display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;
}
h1 { margin: 0; font-size: 1.5rem; color: #1a202c; }
.page-intro {
  color: #4a5568;
  font-size: 0.9rem;
  margin: 0 0 1.5rem;
  line-height: 1.5;
}

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
.btn-link {
  color: #4c51bf;
  text-decoration: none;
  font-size: 0.85rem;
}
.btn-link:hover { text-decoration: underline; }

.loading, .empty {
  text-align: center;
  color: #718096;
  padding: 2rem;
}

.table-wrap { width: 100%; }
.network-table {
  width: 100%;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  border-collapse: separate;
  border-spacing: 0;
}
.network-table th {
  background: #f7fafc; text-align: left;
  padding: 0.75rem 1rem; font-size: 0.75rem;
  font-weight: 600; color: #718096;
  text-transform: uppercase; letter-spacing: 0.05em;
  border-bottom: 1px solid #e2e8f0;
}
.network-table th:first-child { border-top-left-radius: 10px; }
.network-table th:last-child  { border-top-right-radius: 10px; }
.network-table tbody tr:last-child td:first-child { border-bottom-left-radius: 10px; }
.network-table tbody tr:last-child td:last-child  { border-bottom-right-radius: 10px; }
.network-table td { padding: 0.875rem 1rem; border-bottom: 1px solid #f0f4f8; }
.network-table tr:last-child td { border-bottom: none; }
.col-title a { color: #1a202c; text-decoration: none; font-weight: 500; }
.col-title a:hover { color: #4c51bf; text-decoration: underline; }
.col-actions { text-align: right; }
.mono { font-family: monospace; color: #4c51bf; font-size: 0.85rem; }
.dim { color: #718096; font-size: 0.8rem; }

.count-badge {
  display: inline-block;
  font-size: 0.78rem;
  font-weight: 600;
  padding: 0.1rem 0.55rem;
  background: #ebf4ff;
  color: #4c51bf;
  border-radius: 999px;
}
.count-badge.zero { background: #edf2f7; color: #718096; }

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
.form-group input, .form-group textarea {
  display: block; width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid #e2e8f0; border-radius: 6px;
  font-size: 0.9rem;
  font-family: inherit;
}
.hint { margin-top: 0.3rem; font-size: 0.78rem; color: #718096; }
.modal-actions { display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem; }
.error-msg {
  background: #fff5f5; border: 1px solid #fc8181;
  color: #c53030; padding: 0.875rem 1rem;
  border-radius: 8px; margin-bottom: 1rem; font-size: 0.9rem;
}

@media (max-width: 720px) {
  .container { padding: 1rem 0.75rem; }
  .page-header {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }
  .page-header .btn-primary { text-align: center; min-height: 44px; padding: 0.6rem 1rem; }
  .table-wrap { overflow-x: auto; }
  .network-table { min-width: 560px; }
}
</style>
