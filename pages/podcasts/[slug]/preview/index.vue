<template>
  <div class="admin-page">
    <AdminNav :podcast-slug="podcastSlug" />
    <div class="container">
      <div class="page-header">
        <h1>Preview</h1>
        <p class="page-intro">
          What this podcast looks like in a listener app — drafts and scheduled episodes
          included so you can see the whole shelf at a glance. Click an episode title to
          open its full preview. Admin-only.
        </p>
        <PreviewViewToggle v-model="viewMode" />
      </div>

      <div v-if="loadError" class="error-msg">{{ loadError }}</div>

      <div :class="['preview-frame', { mobile: viewMode === 'mobile' }]">
        <div class="preview-screen">
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
              <EpisodePreviewCard
                v-for="ep in episodes"
                :key="ep.id"
                :episode="ep"
                :podcast-slug="podcastSlug"
                :fallback-artwork="podcast.image_url"
              />
            </ul>
          </section>
        </template>
        </div>
      </div>
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
const viewMode = usePreviewViewMode()

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
.page-header h1 { margin: 0 0 0.4rem; font-size: 1.5rem; color: #1a202c; }
.page-intro { color: #4a5568; font-size: 0.9rem; margin: 0 0 0.875rem; line-height: 1.5; }

.error-msg {
  background: #fff5f5;
  border: 1px solid #fc8181;
  color: #c53030;
  padding: 0.875rem 1rem;
  border-radius: 8px;
  margin-bottom: 1rem;
}

/* The preview-frame is the container-query root and is what the mobile
 * toggle constrains. The hero + cards inside use @container preview so
 * their layout adapts to the frame width regardless of window width. */
.preview-frame {
  container-type: inline-size;
  container-name: preview;
}
.preview-frame.mobile {
  max-width: 390px;
  /* Phone-ish viewport: ~720px usable screen + 60px combined top/bottom bezel
   * borders. Content inside scrolls instead of letting the frame grow. */
  height: 780px;
  max-height: calc(100vh - 4rem);
  margin: 0.5rem auto 2rem;
  border: 14px solid #1a202c;
  border-top-width: 30px;
  border-bottom-width: 30px;
  border-radius: 38px;
  background: white;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.18);
  padding: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.preview-frame.mobile .preview-screen {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0.5rem;
  -webkit-overflow-scrolling: touch;
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
.preview-frame.mobile .hero {
  border: none;
  padding: 1rem;
  margin-bottom: 1rem;
  box-shadow: none;
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
.hero-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.hero-art-placeholder {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  color: #a0aec0; font-size: 0.9rem;
}
.hero-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.hero-title { margin: 0; font-size: 1.75rem; color: #1a202c; line-height: 1.2; }
.hero-author { margin: 0; color: #4a5568; font-size: 1rem; }
.hero-tags { display: flex; flex-wrap: wrap; gap: 0.4rem; }
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
.hero-tag.explicit { background: #fed7d7; color: #c53030; }
.hero-description { color: #2d3748; font-size: 0.92rem; line-height: 1.6; }
.hero-description :deep(p) { margin: 0 0 0.7rem; }
.hero-description :deep(p:last-child) { margin-bottom: 0; }
.hero-description :deep(a) { color: #667eea; }
.hero-description :deep(ul), .hero-description :deep(ol) { margin: 0 0 0.7rem 1.25rem; }

.hero-links { display: flex; gap: 1rem; margin-top: 0.4rem; }
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
.preview-frame.mobile .episodes-section {
  border: none;
  padding: 0.75rem;
  border-radius: 0;
}
.episodes-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 1rem;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.episodes-header h2 { margin: 0; font-size: 1.05rem; font-weight: 600; color: #1a202c; }
.count { color: #a0aec0; font-weight: 500; font-size: 0.95rem; margin-left: 0.25rem; }
.legend { display: flex; gap: 0.875rem; font-size: 0.78rem; color: #718096; }
.legend-item { display: inline-flex; align-items: center; gap: 0.35rem; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
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

/* Layout adapts to the preview-frame's inline-size — fires both for
 * narrow windows and for the mobile toggle (which constrains the frame). */
@container preview (max-width: 720px) {
  .hero {
    flex-direction: column;
    padding: 1.25rem;
    gap: 1.25rem;
  }
  .hero-art { width: 100%; max-width: 280px; height: auto; aspect-ratio: 1 / 1; align-self: center; }
  .hero-title { font-size: 1.4rem; }
  .episodes-section { padding: 1rem; }
}

@container preview (max-width: 420px) {
  .hero-art { max-width: 220px; }
  .hero-title { font-size: 1.2rem; }
  .episodes-header h2 { font-size: 0.95rem; }
}

@media (max-width: 720px) {
  .container { padding: 1rem 0.75rem; }
}
</style>
