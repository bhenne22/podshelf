<template>
  <nav class="admin-nav">
    <div class="nav-brand">
      <NuxtLink to="/admin">Podshelf</NuxtLink>
      <NuxtLink
        v-if="podcastSlug"
        :to="`/admin/${podcastSlug}`"
        class="nav-podcast-name"
      >
        / {{ podcast?.title || podcastSlug }}
      </NuxtLink>
    </div>
    <ul class="nav-links">
      <template v-if="podcastSlug">
        <li><NuxtLink :to="`/admin/${podcastSlug}/episodes`" active-class="active">Episodes</NuxtLink></li>
        <li><NuxtLink :to="`/admin/${podcastSlug}/stats`" active-class="active">Analytics</NuxtLink></li>
        <li><NuxtLink :to="`/admin/${podcastSlug}/settings`" active-class="active">Settings</NuxtLink></li>
        <li><NuxtLink :to="`/admin/${podcastSlug}/storage`" active-class="active">Storage</NuxtLink></li>
        <li><NuxtLink :to="`/admin/${podcastSlug}/build`" active-class="active">Build</NuxtLink></li>
        <li><NuxtLink :to="`/admin/${podcastSlug}/members`" active-class="active">Members</NuxtLink></li>
        <li class="divider" />
        <li><NuxtLink to="/admin">All podcasts</NuxtLink></li>
        <li><a :href="`/feeds/${podcastSlug}.xml`" target="_blank" rel="noopener">RSS Feed ↗</a></li>
      </template>
      <template v-else>
        <li><NuxtLink to="/admin" exact-active-class="active">Podcasts</NuxtLink></li>
        <li><NuxtLink to="/admin/api-keys" active-class="active">API Keys</NuxtLink></li>
        <li v-if="me?.is_admin"><NuxtLink to="/admin/users" active-class="active">Users</NuxtLink></li>
      </template>
      <li class="divider" />
      <li><button class="logout-btn" @click="logout">Sign out</button></li>
    </ul>
  </nav>
</template>

<script setup lang="ts">
const props = defineProps<{
  podcastSlug?: string
}>()

interface Me { id: number; email: string; is_admin: boolean }
interface Podcast { id: number; slug: string; title: string }

const { data: me } = await useFetch<Me>('/api/me', { default: () => null })

const podcast = ref<Podcast | null>(null)
if (props.podcastSlug) {
  try {
    podcast.value = await $fetch<Podcast>(`/api/podcasts/${props.podcastSlug}`)
  } catch {
    podcast.value = null
  }
}

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  await navigateTo('/admin/login')
}
</script>

<style scoped>
.admin-nav {
  display: flex;
  align-items: center;
  gap: 2rem;
  background: white;
  border-bottom: 1px solid #e2e8f0;
  padding: 0 1.5rem;
  height: 56px;
  position: sticky;
  top: 0;
  z-index: 100;
}

.nav-brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.nav-brand a {
  font-weight: 700;
  font-size: 1.1rem;
  color: #667eea;
  text-decoration: none;
  letter-spacing: -0.02em;
}

.nav-podcast-name {
  font-size: 0.95rem;
  color: #4a5568;
  text-decoration: none;
}
.nav-podcast-name:hover { color: #667eea; }

.nav-links {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

.nav-links a {
  display: block;
  padding: 0.375rem 0.75rem;
  color: #4a5568;
  text-decoration: none;
  border-radius: 6px;
  font-size: 0.9rem;
  transition: background 0.15s, color 0.15s;
}

.nav-links a:hover {
  background: #f7fafc;
  color: #1a202c;
}

.nav-links a.active {
  background: #ebf4ff;
  color: #4c51bf;
  font-weight: 500;
}

.divider {
  width: 1px;
  height: 20px;
  background: #e2e8f0;
  margin: 0 0.5rem;
}

.logout-btn {
  background: transparent;
  border: none;
  padding: 0.375rem 0.75rem;
  color: #4a5568;
  border-radius: 6px;
  font-size: 0.9rem;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.logout-btn:hover {
  background: #fff5f5;
  color: #c53030;
}
</style>
