<template>
  <nav class="admin-nav" :class="{ 'menu-open': menuOpen }">
    <div class="nav-brand">
      <NuxtLink to="/">Podshelf</NuxtLink>
      <NuxtLink
        v-if="podcastSlug"
        :to="`/podcasts/${podcastSlug}`"
        class="nav-podcast-name"
      >
        <span class="nav-podcast-sep">/</span>
        <img
          v-if="podcast?.image_url"
          :src="podcast.image_url"
          :alt="podcast.title"
          class="nav-podcast-art"
        />
        <span class="nav-podcast-title">{{ podcast?.title || podcastSlug }}</span>
      </NuxtLink>
    </div>
    <ul class="nav-links" :class="{ open: menuOpen }">
      <template v-if="podcastSlug">
        <!-- Primary: stuff you touch most often once a podcast is up -->
        <li><NuxtLink :to="`/podcasts/${podcastSlug}/episodes`" active-class="active">Episodes</NuxtLink></li>
        <li><NuxtLink :to="`/podcasts/${podcastSlug}/people`" active-class="active">People</NuxtLink></li>
        <li><NuxtLink :to="`/podcasts/${podcastSlug}/files`" active-class="active">Files</NuxtLink></li>
        <li><NuxtLink :to="`/podcasts/${podcastSlug}/settings`" active-class="active">Settings</NuxtLink></li>

        <!-- More: rarely-touched setup + admin actions; dropdown on desktop,
             flat list with a section label inside the mobile drawer. -->
        <li class="more-wrap" ref="moreRef" :class="{ 'more-open': moreOpen, 'more-active': isInMoreSection }">
          <button
            type="button"
            class="more-trigger"
            :aria-expanded="moreOpen"
            aria-haspopup="true"
            @click="moreOpen = !moreOpen"
          >
            More <span class="chev">▾</span>
          </button>
          <ul class="more-panel">
            <li class="more-mobile-label">More</li>
            <li><NuxtLink :to="`/podcasts/${podcastSlug}/preview`" active-class="active">Preview</NuxtLink></li>
            <li><NuxtLink :to="`/podcasts/${podcastSlug}/storage`" active-class="active">Storage</NuxtLink></li>
            <li><NuxtLink :to="`/podcasts/${podcastSlug}/distribution`" active-class="active">Distribution</NuxtLink></li>
            <li><NuxtLink :to="`/podcasts/${podcastSlug}/build`" active-class="active">Build</NuxtLink></li>
            <li><NuxtLink :to="`/podcasts/${podcastSlug}/import-rss`" active-class="active">Import / Export</NuxtLink></li>
            <li><NuxtLink :to="`/podcasts/${podcastSlug}/members`" active-class="active">Members</NuxtLink></li>
            <li><NuxtLink :to="`/podcasts/${podcastSlug}/audit`" active-class="active">Audit Log</NuxtLink></li>
            <li class="divider" />
            <li><a :href="`/feeds/${podcastSlug}.xml`" target="_blank" rel="noopener">RSS Feed ↗</a></li>
          </ul>
        </li>

        <li class="divider" />
        <li><NuxtLink to="/">All podcasts</NuxtLink></li>
      </template>
      <template v-else>
        <li><NuxtLink to="/" exact-active-class="active">Podcasts</NuxtLink></li>
        <li><NuxtLink to="/api-keys" active-class="active">API Keys</NuxtLink></li>
        <li><NuxtLink to="/docs" active-class="active">API Docs</NuxtLink></li>
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
interface Podcast { id: number; slug: string; title: string; image_url: string | null }

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
const moreOpen = ref(false)
const moreRef = ref<HTMLElement | null>(null)
const route = useRoute()

// Pages tucked into the "More ▾" dropdown — when the current route is one
// of these, the trigger gets the active style so the user can see where
// they are even though the link isn't directly visible.
const MORE_SEGMENTS = ['preview', 'storage', 'distribution', 'build', 'import-rss', 'members', 'audit']
const isInMoreSection = computed(() => {
  if (!props.podcastSlug) return false
  const base = `/podcasts/${props.podcastSlug}/`
  return MORE_SEGMENTS.some((seg) => route.path.startsWith(base + seg))
})

// Auto-close on navigation so neither the drawer nor the dropdown lingers
// after a tap.
watch(() => route.fullPath, () => {
  menuOpen.value = false
  moreOpen.value = false
})

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (moreOpen.value) moreOpen.value = false
  else if (menuOpen.value) menuOpen.value = false
}

// Click outside the dropdown closes it. The drawer/hamburger has its own
// toggle so we don't need this for menuOpen.
function onDocClick(e: MouseEvent) {
  if (!moreOpen.value) return
  const target = e.target as Node | null
  if (target && moreRef.value && !moreRef.value.contains(target)) {
    moreOpen.value = false
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('click', onDocClick)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('click', onDocClick)
})

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
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
  font-size: 0.95rem;
  color: #4a5568;
  text-decoration: none;
}
.nav-podcast-name:hover { color: #667eea; }
.nav-podcast-name:hover .nav-podcast-art { border-color: #c3dafe; }

.nav-podcast-sep {
  color: #a0aec0;
  flex-shrink: 0;
}

.nav-podcast-art {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  object-fit: cover;
  background: #edf2f7;
  border: 1px solid #e2e8f0;
  flex-shrink: 0;
  transition: border-color 0.15s;
}

.nav-podcast-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

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

/* "More" dropdown — desktop default. */
.more-wrap {
  position: relative;
}
.more-trigger {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.375rem 0.75rem;
  background: transparent;
  border: none;
  color: #4a5568;
  border-radius: 6px;
  font-size: 0.9rem;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.more-trigger:hover { background: #f7fafc; color: #1a202c; }
.more-wrap.more-active .more-trigger,
.more-wrap.more-open .more-trigger {
  background: #ebf4ff;
  color: #4c51bf;
  font-weight: 500;
}
.more-trigger .chev {
  font-size: 0.7rem;
  line-height: 1;
  transition: transform 0.15s;
}
.more-wrap.more-open .more-trigger .chev { transform: rotate(180deg); }

.more-panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 200px;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 0.375rem;
  list-style: none;
  margin: 0;
  display: none;
  flex-direction: column;
  gap: 0.125rem;
  box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.15);
  z-index: 110;
}
.more-wrap.more-open .more-panel { display: flex; }
.more-panel a {
  width: 100%;
  white-space: nowrap;
  /* Without this the link's padding pushes the visible box past the panel's
   * right edge so the hover/active highlight bleeds into the page background. */
  box-sizing: border-box;
}
.more-panel .divider {
  width: auto;
  height: 1px;
  margin: 0.25rem 0.25rem;
  background: #f0f4f8;
}
.more-mobile-label { display: none; }

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

  .nav-podcast-art { width: 24px; height: 24px; }

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

  /* Mobile: kill the dropdown, render More items inline with a label. */
  .more-trigger { display: none; }
  .more-wrap { width: 100%; }
  .more-panel {
    position: static;
    display: flex !important;
    flex-direction: column;
    background: transparent;
    border: none;
    box-shadow: none;
    padding: 0;
    min-width: 0;
    gap: 0;
  }
  .more-mobile-label {
    display: block;
    padding: 0.625rem 1.25rem 0.25rem;
    font-size: 0.7rem;
    font-weight: 600;
    color: #a0aec0;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .more-panel .divider { margin: 0.25rem 0; }
}
</style>
