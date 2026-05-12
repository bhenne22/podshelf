<template>
  <div class="admin-page">
    <AdminNav />
    <div class="container">
      <div class="page-header">
        <h1>Networks</h1>
        <NuxtLink v-if="me?.is_admin" to="/admin/networks" class="btn-primary">Manage networks</NuxtLink>
      </div>

      <div v-if="pending" class="loading">Loading…</div>

      <div v-else-if="!networks || !networks.length" class="empty">
        <p v-if="me?.is_admin">
          No networks yet. <NuxtLink to="/admin/networks">Create one</NuxtLink> to start coordinating sibling shows.
        </p>
        <p v-else>
          You're not part of any network. Networks group sibling shows so hosts can see each other's upcoming
          drops — ask an admin to set one up.
        </p>
      </div>

      <ul v-else class="network-list">
        <li v-for="n in networks" :key="n.id">
          <NuxtLink :to="`/networks/${n.slug}`" class="network-card">
            <div class="network-info">
              <div class="network-title">{{ n.title }}</div>
              <div v-if="n.description" class="network-desc">{{ n.description }}</div>
              <div class="network-meta">
                <span class="slug">/{{ n.slug }}</span>
                <span>· {{ n.podcast_count }} {{ n.podcast_count === 1 ? 'podcast' : 'podcasts' }}</span>
              </div>
            </div>
          </NuxtLink>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

interface Me { id: number; email: string; is_admin: boolean }
interface NetworkListItem {
  id: number
  slug: string
  title: string
  description: string | null
  podcast_count: number
}

const { data: me } = await useFetch<Me>('/api/me')
const { data: networks, pending } = await useFetch<NetworkListItem[]>('/api/networks')

// Single-network case: jump straight to it so this page isn't a needless stop.
if (networks.value && networks.value.length === 1) {
  await navigateTo(`/networks/${networks.value[0].slug}`)
}

useHead({ title: 'Networks · Podshelf' })
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
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  text-decoration: none;
}
.btn-primary:hover { background: #5a67d8; }

.loading, .empty {
  text-align: center;
  color: #718096;
  padding: 3rem;
}
.empty a { color: #667eea; }

.network-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.75rem;
}

.network-card {
  display: block;
  padding: 1rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.15s, transform 0.15s;
}
.network-card:hover {
  border-color: #667eea;
  transform: translateY(-1px);
}

.network-title {
  font-size: 1.05rem;
  font-weight: 600;
  color: #1a202c;
  margin-bottom: 0.25rem;
}
.network-desc {
  font-size: 0.875rem;
  color: #4a5568;
  margin-bottom: 0.25rem;
}
.network-meta {
  font-size: 0.78rem;
  color: #718096;
}
.network-meta .slug {
  font-family: monospace;
  color: #4c51bf;
}
</style>
