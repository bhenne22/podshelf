<template>
  <div class="admin-page">
    <AdminNav :podcast-slug="podcastSlug" />
    <div class="container">
      <div class="page-header">
        <h1>Preview</h1>
        <p class="page-intro">
          What this podcast looks like in a listener app — drafts and scheduled episodes
          included so you can see the whole shelf at a glance. Admin-only.
        </p>
      </div>

      <div v-if="loadError" class="error-msg">{{ loadError }}</div>

      <template v-if="podcast">
        <section class="hero">
          <div class="hero-art">
            <img v-if="podcast.image_url" :src="podcast.image_url" :alt="podcast.title" />
            <div v-else class="hero-art-placeholder">No artwork</div>
          </div>
          <div class="hero-meta">
            <h2 class="hero-title">{{ podcast.title }}</h2>
            <p v-if="podcast.author" class="hero-author">{{ podcast.author }}</p>
            <div class="hero-tags">
              <span v-if="podcast.category" class="hero-tag">{{ podcast.category }}</span>
              <span v-if="podcast.language" class="hero-tag">{{ podcast.language }}</span>
              <span v-if="podcast.explicit === 'true'" class="hero-tag explicit">Explicit</span>
              <span v-if="podcast.itunes_type === 'serial'" class="hero-tag">Serial</span>
            </div>
            <div v-if="podcast.description" class="hero-description" v-html="podcast.description"></div>
            <div class="hero-links">
              <a :href="`/feeds/${podcastSlug}.xml`" target="_blank" rel="noopener" class="hero-link">RSS feed ↗</a>
              <a v-if="podcast.website" :href="podcast.website" target="_blank" rel="noopener" class="hero-link">Website ↗</a>
            </div>
          </div>
        </section>

        <section class="episodes-section">
          <header class="episodes-header">
            <h2>Episodes <span class="count">({{ episodes.length }})</span></h2>
            <div v-if="statusCounts.draft || statusCounts.scheduled" class="legend">
              <span v-if="statusCounts.scheduled" class="legend-item">
                <span class="status-dot scheduled"></span>{{ statusCounts.scheduled }} scheduled
              </span>
              <span v-if="statusCounts.draft" class="legend-item">
                <span class="status-dot draft"></span>{{ statusCounts.draft }} draft
              </span>
            </div>
          </header>

          <div v-if="loadingEpisodes" class="loading">Loading episodes…</div>
          <div v-else-if="!episodes.length" class="empty">No episodes yet.</div>
          <ul v-else class="episode-list">
            <li v-for="ep in episodes" :key="ep.id" class="episode-card" :class="{ [`status-${ep.status}`]: true }">
              <div class="episode-thumb">
                <img :src="ep.image_url || podcast.image_url || ''" :alt="ep.title" v-if="ep.image_url || podcast.image_url" />
                <div v-else class="episode-thumb-placeholder">—</div>
              </div>
              <div class="episode-body">
                <div class="episode-meta-row">
                  <span v-if="episodeNumberDisplay(ep)" class="episode-num">{{ episodeNumberDisplay(ep) }}</span>
                  <span v-if="ep.published_at" class="episode-date" :class="{ scheduled: ep.status === 'scheduled' }">
                    {{ ep.status === 'scheduled' ? 'Scheduled ' : '' }}{{ formatDate(ep.published_at) }}
                  </span>
                  <span v-if="ep.audio_duration_seconds" class="episode-duration">
                    {{ formatDuration(ep.audio_duration_seconds) }}
                  </span>
                  <span v-if="ep.status !== 'published'" :class="['episode-status-badge', ep.status]">
                    {{ ep.status }}
                  </span>
                </div>
                <h3 class="episode-title">{{ ep.title }}</h3>

                <div v-if="ep.audio_url" class="episode-player">
                  <audio :src="ep.audio_url" controls preload="none"></audio>
                </div>
                <div v-else class="episode-player-empty">No audio uploaded yet.</div>

                <div v-if="ep.description" class="episode-notes-wrap">
                  <button type="button" class="notes-toggle" @click="toggleNotes(ep.id)">
                    {{ openNotes.has(ep.id) ? '▾' : '▸' }} Show notes
                  </button>
                  <div v-if="openNotes.has(ep.id)" class="episode-notes" v-html="ep.description"></div>
                </div>
              </div>
            </li>
          </ul>
        </section>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Episode } from '~/composables/useEpisodes'

definePageMeta({ middleware: 'auth' })

interface PodcastForPreview {
  id: number
  slug: string
  title: string
  description: string | null
  author: string | null
  image_url: string | null
  language: string | null
  category: string | null
  explicit: string | null
  website: string | null
  itunes_type: string | null
}

const route = useRoute()
const podcastSlug = route.params.slug as string

const podcast = ref<PodcastForPreview | null>(null)
const episodes = ref<Episode[]>([])
const loadError = ref('')
const loadingEpisodes = ref(true)
const openNotes = reactive(new Set<number>())

function toggleNotes(id: number) {
  if (openNotes.has(id)) openNotes.delete(id)
  else openNotes.add(id)
}

try {
  const [pod, eps] = await Promise.all([
    $fetch<PodcastForPreview>(`/api/podcasts/${podcastSlug}`),
    $fetch<Episode[]>(`/api/podcasts/${podcastSlug}/episodes`),
  ])
  podcast.value = pod
  episodes.value = eps
} catch (err: unknown) {
  loadError.value = err instanceof Error ? err.message : 'Failed to load preview'
} finally {
  loadingEpisodes.value = false
}

const statusCounts = computed(() => ({
  draft: episodes.value.filter((e) => e.status === 'draft').length,
  scheduled: episodes.value.filter((e) => e.status === 'scheduled').length,
  published: episodes.value.filter((e) => e.status === 'published').length,
}))

function episodeNumberDisplay(ep: Episode): string {
  // Prefer the explicit per-episode override, then S/E formatting, then nothing.
  if (ep.episode_display) return ep.episode_display
  const s = ep.season_number
  const e = ep.episode_number
  if (s != null && e != null) return `S${s}E${e}`
  if (e != null) return `Ep ${e}`
  return ''
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m} min`
}

useHead({ title: () => `Preview: ${podcast.value?.title || podcastSlug} — Podshelf Admin` })
</script>

<style scoped>
* { box-sizing: border-box; }

.admin-page {
  min-height: 100vh;
  background: #f7fafc;
  font-family: system-ui, sans-serif;
}

.container {
  max-width: 1000px;
  margin: 0 auto;
  padding: 2rem 1.25rem;
}

.page-header { margin-bottom: 1.5rem; }
h1 { margin: 0 0 0.4rem; font-size: 1.5rem; color: #1a202c; }
.page-intro { color: #4a5568; font-size: 0.9rem; margin: 0; line-height: 1.5; }

.error-msg {
  background: #fff5f5;
  border: 1px solid #fc8181;
  color: #c53030;
  padding: 0.875rem 1rem;
  border-radius: 8px;
  margin-bottom: 1rem;
}

/* Hero */
.hero {
  display: flex;
  gap: 1.75rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 1.75rem;
  margin-bottom: 1.75rem;
}
.hero-art {
  flex-shrink: 0;
  width: 240px;
  height: 240px;
  border-radius: 12px;
  overflow: hidden;
  background: #edf2f7;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}
.hero-art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.hero-art-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #a0aec0;
  font-size: 0.9rem;
}
.hero-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.hero-title {
  margin: 0;
  font-size: 1.75rem;
  color: #1a202c;
  line-height: 1.2;
}
.hero-author {
  margin: 0;
  color: #4a5568;
  font-size: 1rem;
}
.hero-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.hero-tag {
  font-size: 0.72rem;
  background: #edf2f7;
  color: #4a5568;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 600;
}
.hero-tag.explicit {
  background: #fed7d7;
  color: #c53030;
}
.hero-description {
  color: #2d3748;
  font-size: 0.92rem;
  line-height: 1.6;
  /* Show-notes HTML — let the editor's formatting through but tighten margins. */
}
.hero-description :deep(p) { margin: 0 0 0.7rem; }
.hero-description :deep(p:last-child) { margin-bottom: 0; }
.hero-description :deep(a) { color: #667eea; }
.hero-description :deep(ul), .hero-description :deep(ol) { margin: 0 0 0.7rem 1.25rem; }

.hero-links {
  display: flex;
  gap: 1rem;
  margin-top: 0.4rem;
}
.hero-link {
  color: #667eea;
  text-decoration: none;
  font-size: 0.85rem;
  font-weight: 500;
}
.hero-link:hover { text-decoration: underline; }

/* Episodes */
.episodes-section {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 1.5rem;
}
.episodes-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 1rem;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.episodes-header h2 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  color: #1a202c;
}
.count {
  color: #a0aec0;
  font-weight: 500;
  font-size: 0.95rem;
  margin-left: 0.25rem;
}
.legend {
  display: flex;
  gap: 0.875rem;
  font-size: 0.78rem;
  color: #718096;
}
.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.status-dot.draft { background: #f6e05e; }
.status-dot.scheduled { background: #667eea; }

.loading, .empty {
  color: #718096;
  padding: 1.5rem 0.25rem;
  font-size: 0.9rem;
}

.episode-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.episode-card {
  display: flex;
  gap: 1rem;
  padding: 1rem 0;
  border-bottom: 1px solid #f0f4f8;
}
.episode-card:last-child { border-bottom: none; }
.episode-card.status-draft { opacity: 0.85; }

.episode-thumb {
  flex-shrink: 0;
  width: 72px;
  height: 72px;
  border-radius: 8px;
  overflow: hidden;
  background: #edf2f7;
}
.episode-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.episode-thumb-placeholder {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  color: #a0aec0; font-size: 1.2rem;
}

.episode-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.4rem; }

.episode-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.875rem;
  align-items: center;
  font-size: 0.78rem;
  color: #718096;
}

.episode-num {
  font-weight: 600;
  color: #4a5568;
  background: #edf2f7;
  padding: 0.1rem 0.45rem;
  border-radius: 4px;
}
.episode-date.scheduled { color: #4c51bf; font-style: italic; }
.episode-duration { font-variant-numeric: tabular-nums; }

.episode-status-badge {
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: capitalize;
}
.episode-status-badge.draft { background: #fef3c7; color: #92400e; }
.episode-status-badge.scheduled { background: #ebf4ff; color: #4c51bf; }

.episode-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: #1a202c;
  line-height: 1.35;
}

.episode-player audio {
  width: 100%;
  margin-top: 0.4rem;
  height: 36px;
}
.episode-player-empty {
  font-size: 0.82rem;
  color: #a0aec0;
  padding: 0.5rem 0.75rem;
  background: #f7fafc;
  border: 1px dashed #e2e8f0;
  border-radius: 6px;
  margin-top: 0.4rem;
}

.episode-notes-wrap { margin-top: 0.25rem; }
.notes-toggle {
  background: none;
  border: none;
  color: #667eea;
  cursor: pointer;
  padding: 0.25rem 0;
  font-size: 0.82rem;
  font-weight: 500;
  font-family: inherit;
}
.notes-toggle:hover { text-decoration: underline; }

.episode-notes {
  margin-top: 0.4rem;
  padding: 0.75rem 0.875rem;
  background: #f7fafc;
  border-radius: 6px;
  font-size: 0.88rem;
  color: #2d3748;
  line-height: 1.6;
}
.episode-notes :deep(p) { margin: 0 0 0.6rem; }
.episode-notes :deep(p:last-child) { margin-bottom: 0; }
.episode-notes :deep(a) { color: #667eea; }
.episode-notes :deep(ul), .episode-notes :deep(ol) { margin: 0 0 0.6rem 1.25rem; }

@media (max-width: 720px) {
  .container { padding: 1rem 0.75rem; }
  .hero {
    flex-direction: column;
    padding: 1.25rem;
    gap: 1.25rem;
  }
  .hero-art { width: 100%; max-width: 280px; height: auto; aspect-ratio: 1 / 1; align-self: center; }
  .hero-title { font-size: 1.4rem; }
  .episodes-section { padding: 1rem; }
  .episode-card { flex-direction: row; gap: 0.75rem; }
  .episode-thumb { width: 56px; height: 56px; }
}
</style>
