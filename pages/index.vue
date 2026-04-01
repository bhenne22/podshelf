<template>
  <div class="public-site">
    <header class="site-header">
      <div class="container">
        <div class="site-identity">
          <img
            v-if="settings?.show_image_url"
            :src="settings.show_image_url"
            :alt="settings?.show_title"
            class="show-art"
          />
          <div>
            <h1 class="show-title">{{ settings?.show_title || 'My Podcast' }}</h1>
            <p v-if="settings?.show_author" class="show-author">by {{ settings.show_author }}</p>
          </div>
        </div>
        <div class="header-actions">
          <a href="/feed.xml" class="rss-btn" title="Subscribe via RSS">
            <span class="rss-icon">&#9656;</span> Subscribe via RSS
          </a>
        </div>
      </div>
    </header>

    <main class="container">
      <p v-if="settings?.show_description" class="show-description">
        {{ settings.show_description }}
      </p>

      <div v-if="pending" class="loading">Loading episodes…</div>
      <div v-else-if="error" class="error-msg">Failed to load episodes.</div>
      <div v-else-if="!episodes?.length" class="empty">
        <p>No episodes published yet. Check back soon!</p>
      </div>
      <div v-else class="episode-list">
        <EpisodeCard v-for="ep in episodes" :key="ep.id" :episode="ep" />
      </div>
    </main>

    <footer class="site-footer">
      <div class="container">
        <p>
          <span v-if="settings?.show_copyright">{{ settings.show_copyright }}</span>
          &nbsp;&middot;&nbsp;
          <a href="/feed.xml">RSS Feed</a>
          &nbsp;&middot;&nbsp;
          Powered by <a href="https://github.com/your-repo/podshelf" target="_blank" rel="noopener">Podshelf</a>
        </p>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
interface Episode {
  id: number
  title: string
  slug: string
  episode_number: number | null
  description: string | null
  audio_duration_seconds: number | null
  published_at: string | null
  tags: string | null
}

const { data: settings } = await useFetch<Record<string, string>>('/api/settings')
const { data: episodes, pending, error } = await useFetch<Episode[]>('/api/episodes', {
  query: { status: 'published' },
})

useSeoMeta({
  title: settings.value?.show_title || 'My Podcast',
  description: settings.value?.show_description || '',
})
</script>

<style scoped>
* {
  box-sizing: border-box;
}

.public-site {
  min-height: 100vh;
  background: #fffdf9;
  font-family: Georgia, 'Times New Roman', serif;
  color: #2d2a1e;
}

.container {
  max-width: 760px;
  margin: 0 auto;
  padding: 0 1.25rem;
}

.site-header {
  background: #fff;
  border-bottom: 1px solid #e8e4dc;
  padding: 2rem 0;
}

.site-header .container {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  flex-wrap: wrap;
}

.site-identity {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.show-art {
  width: 72px;
  height: 72px;
  border-radius: 10px;
  object-fit: cover;
  flex-shrink: 0;
}

.show-title {
  margin: 0;
  font-size: 1.75rem;
  line-height: 1.2;
  color: #1a1208;
}

.show-author {
  margin: 0.25rem 0 0;
  font-size: 0.9rem;
  color: #8a7e6a;
  font-style: italic;
}

.rss-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 1rem;
  background: #f97316;
  color: white;
  text-decoration: none;
  border-radius: 999px;
  font-size: 0.875rem;
  font-weight: 600;
  font-family: system-ui, sans-serif;
  transition: background 0.15s;
}

.rss-btn:hover {
  background: #ea6c0a;
}

.rss-icon {
  font-size: 1rem;
}

main.container {
  padding-top: 2rem;
  padding-bottom: 3rem;
}

.show-description {
  font-size: 1.05rem;
  line-height: 1.7;
  color: #5a5040;
  margin-bottom: 2rem;
  font-style: italic;
}

.episode-list {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.loading, .empty {
  text-align: center;
  color: #8a7e6a;
  padding: 3rem 0;
  font-size: 1rem;
}

.error-msg {
  color: #c53030;
  padding: 1rem;
  background: #fff5f5;
  border-radius: 8px;
}

.site-footer {
  border-top: 1px solid #e8e4dc;
  padding: 1.5rem 0;
  text-align: center;
  font-family: system-ui, sans-serif;
  font-size: 0.8rem;
  color: #a0916e;
}

.site-footer a {
  color: #92400e;
  text-decoration: none;
}

.site-footer a:hover {
  text-decoration: underline;
}
</style>
