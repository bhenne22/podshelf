<template>
  <div class="admin-page">
    <AdminNav />
    <div class="container">
      <div class="page-header">
        <h1>Podcasts</h1>
        <NuxtLink v-if="me?.is_admin" to="/admin/podcasts/new" class="btn-primary">+ New Podcast</NuxtLink>
      </div>

      <div v-if="pending" class="loading">Loading…</div>

      <div v-else-if="!podcasts || !podcasts.length" class="empty">
        <p v-if="me?.is_admin">No podcasts yet. Create your first one.</p>
        <p v-else>You don't have access to any podcasts. Ask an admin to grant you access.</p>
      </div>

      <ul v-else class="podcast-list">
        <li v-for="p in podcasts" :key="p.id" :class="{ 'inactive-row': p.status === 'inactive' }">
          <NuxtLink :to="`/admin/${p.slug}/episodes`" class="podcast-card">
            <img v-if="p.image_url" :src="p.image_url" :alt="p.title" class="podcast-art" />
            <div v-else class="podcast-art placeholder" />
            <div class="podcast-info">
              <div class="podcast-title">
                {{ p.title }}
                <span v-if="p.status === 'inactive'" class="badge-awaiting">Awaiting Purge</span>
              </div>
              <div class="podcast-desc">{{ p.description || '—' }}</div>
              <div class="podcast-meta">
                <span class="slug">/{{ p.slug }}</span>
                <span v-if="p.website">· {{ p.website }}</span>
                <span v-if="p.status === 'inactive' && p.deleted_at">
                  · deleted {{ formatDate(p.deleted_at) }}
                </span>
              </div>
            </div>
          </NuxtLink>
          <button
            v-if="p.status === 'inactive'"
            type="button"
            class="restore-btn"
            :disabled="restoring === p.id"
            @click="restorePodcast(p)"
          >
            {{ restoring === p.id ? 'Restoring…' : 'Restore' }}
          </button>
        </li>
      </ul>

      <p v-if="me?.is_admin && podcasts && podcasts.some((p) => p.status === 'inactive')" class="admin-purge-link">
        <NuxtLink to="/admin/inactive-podcasts">→ Manage inactive podcasts (admin)</NuxtLink>
      </p>
      <p v-else-if="me?.is_admin" class="admin-purge-link">
        <NuxtLink to="/admin/inactive-podcasts">→ Inactive podcasts (admin)</NuxtLink>
      </p>
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
  website: string | null
  status: string
  deleted_at: string | null
}
interface Me { id: number; email: string; is_admin: boolean }

const { data: me } = await useFetch<Me>('/api/me')
const { data: podcasts, pending, refresh } = await useFetch<Podcast[]>('/api/podcasts')

const restoring = ref<number | null>(null)

async function restorePodcast(p: Podcast) {
  if (!confirm(`Restore "${p.title}"?`)) return
  restoring.value = p.id
  try {
    await $fetch(`/api/podcasts/${p.slug}/restore`, { method: 'POST' })
    await refresh()
  } catch (err: unknown) {
    alert((err as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Failed to restore')
  } finally {
    restoring.value = null
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

useHead({ title: 'Podshelf Admin' })
</script>

<style scoped>
* { box-sizing: border-box; }

.admin-page {
  min-height: 100vh;
  background: #f7fafc;
  font-family: system-ui, sans-serif;
}

.container {
  max-width: 900px;
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
}
.btn-primary:hover { background: #5a67d8; }

.loading, .empty {
  text-align: center;
  color: #718096;
  padding: 3rem;
}

.podcast-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.75rem;
}

.podcast-list li {
  position: relative;
  display: flex;
  align-items: stretch;
}

.podcast-card {
  display: flex;
  gap: 1rem;
  padding: 1rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.15s, transform 0.15s;
  flex: 1;
}
.podcast-card:hover {
  border-color: #667eea;
  transform: translateY(-1px);
}

.inactive-row .podcast-card {
  background: #fffaf0;
  border-color: #fbd38d;
  opacity: 0.85;
}
.inactive-row .podcast-card:hover { opacity: 1; }

.badge-awaiting {
  display: inline-block;
  font-size: 0.7rem;
  padding: 0.15rem 0.5rem;
  margin-left: 0.5rem;
  background: #fef5e7;
  color: #b7791f;
  border: 1px solid #f6ad55;
  border-radius: 999px;
  font-weight: 600;
  letter-spacing: 0.02em;
  vertical-align: 1px;
}

.restore-btn {
  align-self: center;
  margin-left: 0.75rem;
  padding: 0.45rem 0.875rem;
  background: #ebf4ff;
  border: 1px solid #c3dafe;
  color: #4c51bf;
  border-radius: 6px;
  font-size: 0.825rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}
.restore-btn:hover:not(:disabled) {
  background: #c3dafe;
}
.restore-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.admin-purge-link {
  margin-top: 1.5rem;
  font-size: 0.85rem;
}
.admin-purge-link a {
  color: #667eea;
  text-decoration: none;
}
.admin-purge-link a:hover { text-decoration: underline; }

.podcast-art {
  width: 64px;
  height: 64px;
  border-radius: 8px;
  object-fit: cover;
  background: #edf2f7;
  flex-shrink: 0;
}
.podcast-art.placeholder { background: #edf2f7; }

.podcast-info {
  flex: 1;
  min-width: 0;
}

.podcast-title {
  font-size: 1.05rem;
  font-weight: 600;
  color: #1a202c;
  margin-bottom: 0.25rem;
}

.podcast-desc {
  font-size: 0.875rem;
  color: #4a5568;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 0.25rem;
}

.podcast-meta {
  font-size: 0.78rem;
  color: #718096;
}

.podcast-meta .slug {
  font-family: monospace;
  color: #4c51bf;
}
</style>
