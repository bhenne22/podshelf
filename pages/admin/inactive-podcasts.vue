<template>
  <div class="admin-page">
    <AdminNav />
    <div class="container">
      <h1>Inactive Podcasts</h1>
      <p class="hint">Soft-deleted podcasts. Restore brings the RSS feed back online; Permanently Delete cascades to episodes, downloads, and members.</p>

      <div v-if="pending" class="loading">Loading…</div>

      <div v-else-if="!isAdmin" class="error-msg">Admin access required.</div>

      <div v-else-if="!podcasts || !podcasts.length" class="empty">
        <p>No inactive podcasts.</p>
      </div>

      <ul v-else class="podcast-list">
        <li v-for="p in podcasts" :key="p.id">
          <img v-if="p.image_url" :src="p.image_url" :alt="p.title" class="podcast-art" />
          <div v-else class="podcast-art placeholder" />
          <div class="podcast-info">
            <div class="podcast-title">{{ p.title }}</div>
            <div class="podcast-desc">{{ p.description || '—' }}</div>
            <div class="podcast-meta">
              <span class="slug">/{{ p.slug }}</span>
              <span v-if="p.deleted_at"> · deleted {{ formatDate(p.deleted_at) }}</span>
            </div>
          </div>
          <div class="actions">
            <button class="btn-restore" :disabled="busy === p.id" @click="restore(p)">
              {{ busy === p.id && action === 'restore' ? 'Restoring…' : 'Restore' }}
            </button>
            <button class="btn-danger" :disabled="busy === p.id" @click="purge(p)">
              {{ busy === p.id && action === 'purge' ? 'Purging…' : 'Permanently Delete' }}
            </button>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'admin-auth' })

interface Podcast {
  id: number
  slug: string
  title: string
  description: string | null
  image_url: string | null
  deleted_at: string | null
}
interface Me { id: number; email: string; is_admin: boolean }

const { data: me } = await useFetch<Me>('/api/me')
const isAdmin = computed(() => !!me.value?.is_admin)

const { data: podcasts, pending, refresh } = await useFetch<Podcast[]>('/api/admin/inactive-podcasts', {
  default: () => [],
})

const busy = ref<number | null>(null)
const action = ref<'restore' | 'purge' | null>(null)

async function restore(p: Podcast) {
  busy.value = p.id
  action.value = 'restore'
  try {
    await $fetch(`/api/podcasts/${p.slug}/restore`, { method: 'POST' })
    await refresh()
  } catch (err: unknown) {
    alert((err as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Failed to restore')
  } finally {
    busy.value = null
    action.value = null
  }
}

async function purge(p: Podcast) {
  if (!confirm(`Permanently delete "${p.title}"?\n\nThis cascades to all episodes, downloads, members, and API key scopes. Cannot be undone.`)) return
  busy.value = p.id
  action.value = 'purge'
  try {
    await $fetch(`/api/podcasts/${p.slug}/purge`, { method: 'DELETE' })
    await refresh()
  } catch (err: unknown) {
    alert((err as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Failed to purge')
  } finally {
    busy.value = null
    action.value = null
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

useHead({ title: 'Inactive Podcasts — Podshelf Admin' })
</script>

<style scoped>
* { box-sizing: border-box; }

.admin-page { min-height: 100vh; background: #f7fafc; font-family: system-ui, sans-serif; }
.container { max-width: 900px; margin: 0 auto; padding: 2rem 1.25rem; }
h1 { margin: 0 0 0.25rem; font-size: 1.5rem; color: #1a202c; }
.hint { font-size: 0.85rem; color: #718096; margin-bottom: 1.5rem; }
.loading, .empty { text-align: center; color: #718096; padding: 3rem; }
.error-msg {
  background: #fff5f5;
  border: 1px solid #fc8181;
  color: #c53030;
  padding: 0.875rem 1rem;
  border-radius: 8px;
}

.podcast-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.75rem;
}
.podcast-list li {
  display: flex;
  gap: 1rem;
  padding: 1rem;
  background: #fffaf0;
  border: 1px solid #fbd38d;
  border-radius: 10px;
  align-items: center;
}
.podcast-art {
  width: 64px;
  height: 64px;
  border-radius: 8px;
  object-fit: cover;
  background: #edf2f7;
  flex-shrink: 0;
}
.podcast-art.placeholder { background: #edf2f7; }
.podcast-info { flex: 1; min-width: 0; }
.podcast-title { font-size: 1.05rem; font-weight: 600; color: #1a202c; }
.podcast-desc {
  font-size: 0.875rem;
  color: #4a5568;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.podcast-meta { font-size: 0.78rem; color: #718096; margin-top: 0.25rem; }
.podcast-meta .slug { font-family: monospace; color: #4c51bf; }

.actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

.btn-restore,
.btn-danger {
  padding: 0.5rem 0.875rem;
  border-radius: 6px;
  font-size: 0.825rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-restore {
  background: #ebf4ff;
  border: 1px solid #c3dafe;
  color: #4c51bf;
}
.btn-restore:hover:not(:disabled) { background: #c3dafe; }
.btn-danger {
  background: #e53e3e;
  border: none;
  color: white;
}
.btn-danger:hover:not(:disabled) { background: #c53030; }
button:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
