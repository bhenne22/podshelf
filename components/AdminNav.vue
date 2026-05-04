<template>
  <nav class="admin-nav" :class="{ 'menu-open': menuOpen }">
    <div class="nav-brand">
      <NuxtLink to="/">Podshelf</NuxtLink>
      <NuxtLink
        v-if="podcastSlug"
        :to="`/podcasts/${podcastSlug}`"
        class="nav-podcast-name"
      >
        / {{ podcast?.title || podcastSlug }}
      </NuxtLink>
    </div>
    <ul class="nav-links" :class="{ open: menuOpen }">
      <template v-if="podcastSlug">
        <li><NuxtLink :to="`/podcasts/${podcastSlug}/episodes`" active-class="active">Episodes</NuxtLink></li>
        <li><NuxtLink :to="`/podcasts/${podcastSlug}/people`" active-class="active">People</NuxtLink></li>
        <li><NuxtLink :to="`/podcasts/${podcastSlug}/settings`" active-class="active">Settings</NuxtLink></li>
        <li><NuxtLink :to="`/podcasts/${podcastSlug}/storage`" active-class="active">Storage</NuxtLink></li>
        <li><NuxtLink :to="`/podcasts/${podcastSlug}/files`" active-class="active">Files</NuxtLink></li>
        <li><NuxtLink :to="`/podcasts/${podcastSlug}/build`" active-class="active">Build</NuxtLink></li>
        <li><NuxtLink :to="`/podcasts/${podcastSlug}/import-rss`" active-class="active">Import / Export</NuxtLink></li>
        <li><NuxtLink :to="`/podcasts/${podcastSlug}/members`" active-class="active">Members</NuxtLink></li>
        <li><NuxtLink :to="`/podcasts/${podcastSlug}/audit`" active-class="active">Audit Log</NuxtLink></li>
        <li class="divider" />
        <li><NuxtLink to="/">All podcasts</NuxtLink></li>
        <li><a :href="`/feeds/${podcastSlug}.xml`" target="_blank" rel="noopener">RSS Feed ↗</a></li>
      </template>
      <template v-else>
        <li><NuxtLink to="/" exact-active-class="active">Podcasts</NuxtLink></li>
        <li><NuxtLink to="/api-keys" active-class="active">API Keys</NuxtLink></li>
        <li v-if="me?.is_admin"><NuxtLink to="/admin/users" active-class="active">Users</NuxtLink></li>
      </template>
      <li class="divider" />
      <li><button class="logout-btn" @click="logout">Sign out</button></li>
    </ul>
    <button
      class="hamburger"
      type="button"
      :aria-expanded="menuOpen"
      aria-label="Toggle menu"
      @click="menuOpen = !menuOpen"
    >
      <span></span><span></span><span></span>
    </button>
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

const menuOpen = ref(false)
const route = useRoute()

// Auto-close on navigation so the drawer doesn't linger after a tap.
watch(() => route.fullPath, () => {
  menuOpen.value = false
})

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && menuOpen.value) menuOpen.value = false
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  await navigateTo('/login')
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
  min-width: 0;
}

.nav-brand a {
  font-weight: 700;
  font-size: 1.1rem;
  color: #667eea;
  text-decoration: none;
  letter-spacing: -0.02em;
  white-space: nowrap;
}

.nav-podcast-name {
  font-size: 0.95rem;
  color: #4a5568;
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.hamburger {
  display: none;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 0;
  width: 44px;
  height: 44px;
  margin-left: auto;
  cursor: pointer;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.hamburger span {
  width: 18px;
  height: 2px;
  background: #4a5568;
  border-radius: 2px;
  transition: transform 0.15s ease, opacity 0.15s ease;
}
.menu-open .hamburger span:nth-child(1) { transform: translateY(6px) rotate(45deg); }
.menu-open .hamburger span:nth-child(2) { opacity: 0; }
.menu-open .hamburger span:nth-child(3) { transform: translateY(-6px) rotate(-45deg); }

@media (max-width: 720px) {
  .admin-nav {
    padding: 0 0.75rem;
    gap: 0.75rem;
  }
  .hamburger { display: flex; }

  .nav-links {
    /* Drawer slides down beneath the bar. Hidden by default; max-height
       is animated so the menu doesn't pop. Sits absolute so it doesn't
       reflow the page below. */
    position: absolute;
    left: 0;
    right: 0;
    top: 100%;
    flex-direction: column;
    align-items: stretch;
    padding: 0;
    gap: 0;
    background: white;
    border-bottom: 1px solid #e2e8f0;
    box-shadow: 0 6px 12px -8px rgba(0, 0, 0, 0.15);
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.2s ease;
  }
  .nav-links.open {
    max-height: calc(100vh - 56px);
    overflow-y: auto;
  }
  .nav-links li { width: 100%; }
  .nav-links a, .logout-btn {
    display: block;
    width: 100%;
    box-sizing: border-box;
    text-align: left;
    padding: 0.875rem 1.25rem;
    font-size: 0.95rem;
    border-radius: 0;
    min-height: 44px;
  }
  .nav-links a:hover { background: #f7fafc; }
  .nav-links a.active {
    background: #ebf4ff;
    border-left: 3px solid #4c51bf;
    padding-left: calc(1.25rem - 3px);
  }
  .divider {
    width: auto;
    height: 1px;
    background: #f0f4f8;
    margin: 0.25rem 0;
  }
}
</style>
