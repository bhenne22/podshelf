<template>
  <div class="admin-page">
    <AdminNav />
    <div class="container">
      <h1>Dashboard</h1>

      <div v-if="pending" class="loading">Loading…</div>
      <div v-else class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">{{ stats.total }}</div>
          <div class="stat-label">Total Episodes</div>
        </div>
        <div class="stat-card stat-published">
          <div class="stat-value">{{ stats.published }}</div>
          <div class="stat-label">Published</div>
        </div>
        <div class="stat-card stat-draft">
          <div class="stat-value">{{ stats.draft }}</div>
          <div class="stat-label">Drafts</div>
        </div>
      </div>

      <div class="quick-links">
        <h2>Quick Actions</h2>
        <div class="links-grid">
          <NuxtLink to="/admin/episodes/new" class="quick-link primary">
            + New Episode
          </NuxtLink>
          <NuxtLink to="/admin/episodes" class="quick-link">
            Manage Episodes
          </NuxtLink>
          <NuxtLink to="/admin/settings" class="quick-link">
            Show Settings
          </NuxtLink>
          <a href="/feed.xml" target="_blank" rel="noopener" class="quick-link">
            View RSS Feed ↗
          </a>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'admin-auth' })

interface Episode {
  id: number
  status: string
}

const { data: episodes, pending } = await useFetch<Episode[]>('/api/episodes')

const stats = computed(() => {
  if (!episodes.value) return { total: 0, published: 0, draft: 0 }
  return {
    total: episodes.value.length,
    published: episodes.value.filter((e) => e.status === 'published').length,
    draft: episodes.value.filter((e) => e.status === 'draft').length,
  }
})

useHead({ title: 'Dashboard — Podshelf Admin' })
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

h1 {
  margin: 0 0 1.5rem;
  font-size: 1.5rem;
  color: #1a202c;
}

h2 {
  margin: 0 0 1rem;
  font-size: 1rem;
  color: #4a5568;
  font-weight: 600;
}

.loading {
  color: #718096;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 1rem;
  margin-bottom: 2.5rem;
}

.stat-card {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 1.5rem;
  text-align: center;
}

.stat-value {
  font-size: 2.5rem;
  font-weight: 700;
  color: #1a202c;
  line-height: 1;
  margin-bottom: 0.375rem;
}

.stat-label {
  font-size: 0.8rem;
  color: #718096;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.stat-published .stat-value { color: #2f855a; }
.stat-draft .stat-value { color: #b7791f; }

.links-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.75rem;
}

.quick-link {
  display: block;
  padding: 0.875rem 1.25rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  text-decoration: none;
  color: #4a5568;
  font-size: 0.9rem;
  font-weight: 500;
  text-align: center;
  transition: all 0.15s;
}

.quick-link:hover {
  border-color: #667eea;
  color: #4c51bf;
  background: #ebf4ff;
}

.quick-link.primary {
  background: #667eea;
  color: white;
  border-color: #667eea;
}

.quick-link.primary:hover {
  background: #5a67d8;
  border-color: #5a67d8;
}
</style>
