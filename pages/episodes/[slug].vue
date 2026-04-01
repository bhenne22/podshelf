<template>
  <div class="episode-page" v-if="episode">
    <div class="container">
      <nav class="breadcrumb">
        <NuxtLink to="/">← All Episodes</NuxtLink>
      </nav>

      <article class="episode-article">
        <header class="episode-header">
          <div class="episode-meta">
            <span v-if="episode.episode_number" class="episode-number">
              Episode {{ episode.episode_number }}
              <span v-if="episode.season_number"> · Season {{ episode.season_number }}</span>
            </span>
            <span v-if="episode.published_at" class="episode-date">
              {{ formatDate(episode.published_at) }}
            </span>
          </div>
          <h1 class="episode-title">{{ episode.title }}</h1>
        </header>

        <AudioPlayer :audioUrl="episode.audio_url" :title="episode.title" />

        <div
          v-if="episode.description"
          class="episode-shownotes"
          v-html="episode.description"
        ></div>

        <div v-if="episode.tags" class="episode-tags">
          <span
            v-for="tag in parseTags(episode.tags)"
            :key="tag"
            class="tag"
          >{{ tag }}</span>
        </div>
      </article>

      <div class="back-link">
        <NuxtLink to="/">← Back to all episodes</NuxtLink>
      </div>
    </div>
  </div>

  <div v-else-if="pending" class="container loading">Loading episode…</div>

  <div v-else class="container error-msg">
    <p>Episode not found.</p>
    <NuxtLink to="/">← Back to all episodes</NuxtLink>
  </div>
</template>

<script setup lang="ts">
interface Episode {
  id: number
  title: string
  slug: string
  episode_number: number | null
  season_number: number | null
  description: string | null
  audio_url: string | null
  audio_duration_seconds: number | null
  published_at: string | null
  status: string
  tags: string | null
}

const route = useRoute()
const slug = route.params.slug as string

// Fetch all published episodes and find the one matching the slug
const { data: allEpisodes, pending } = await useFetch<Episode[]>('/api/episodes', {
  query: { status: 'published' },
})

const episode = computed(() => allEpisodes.value?.find((e) => e.slug === slug) ?? null)

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function parseTags(tags: string): string[] {
  return tags.split(',').map((t) => t.trim()).filter(Boolean)
}

useSeoMeta({
  title: () => episode.value?.title || 'Episode',
  description: () => {
    const desc = episode.value?.description?.replace(/<[^>]+>/g, '') || ''
    return desc.slice(0, 160)
  },
})
</script>

<style scoped>
* {
  box-sizing: border-box;
}

.episode-page {
  min-height: 100vh;
  background: #fffdf9;
  font-family: Georgia, 'Times New Roman', serif;
  color: #2d2a1e;
}

.container {
  max-width: 720px;
  margin: 0 auto;
  padding: 0 1.25rem;
}

.breadcrumb {
  padding: 1.5rem 0 0;
  font-family: system-ui, sans-serif;
  font-size: 0.875rem;
}

.breadcrumb a {
  color: #92400e;
  text-decoration: none;
}

.breadcrumb a:hover {
  text-decoration: underline;
}

.episode-article {
  padding: 1.5rem 0 3rem;
}

.episode-header {
  margin-bottom: 0.5rem;
}

.episode-meta {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 0.75rem;
  font-family: system-ui, sans-serif;
  font-size: 0.8rem;
}

.episode-number {
  font-weight: 600;
  color: #b7791f;
  background: #fef9c3;
  border-radius: 4px;
  padding: 0.15rem 0.5rem;
}

.episode-date {
  color: #a0916e;
}

.episode-title {
  margin: 0;
  font-size: 2rem;
  line-height: 1.3;
  color: #1a1208;
}

.episode-shownotes {
  line-height: 1.8;
  font-size: 1.05rem;
  color: #3d3420;
}

.episode-shownotes :deep(p) {
  margin-bottom: 1.25em;
}

.episode-shownotes :deep(a) {
  color: #92400e;
}

.episode-shownotes :deep(h2),
.episode-shownotes :deep(h3) {
  color: #1a1208;
  margin-top: 2em;
}

.episode-shownotes :deep(ul),
.episode-shownotes :deep(ol) {
  padding-left: 1.5em;
  margin-bottom: 1.25em;
}

.episode-shownotes :deep(li) {
  margin-bottom: 0.5em;
}

.episode-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 2rem;
  padding-top: 1.5rem;
  border-top: 1px solid #e8e4dc;
}

.tag {
  background: #fef3c7;
  color: #92400e;
  font-size: 0.8rem;
  font-family: system-ui, sans-serif;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
}

.back-link {
  padding-bottom: 3rem;
  font-family: system-ui, sans-serif;
  font-size: 0.875rem;
}

.back-link a {
  color: #92400e;
  text-decoration: none;
}

.back-link a:hover {
  text-decoration: underline;
}

.loading, .error-msg {
  padding: 3rem 1.25rem;
  text-align: center;
  color: #8a7e6a;
  font-family: system-ui, sans-serif;
}

.error-msg a {
  color: #92400e;
  text-decoration: none;
  display: block;
  margin-top: 1rem;
}
</style>
