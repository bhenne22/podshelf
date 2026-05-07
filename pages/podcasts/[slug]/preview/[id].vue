<template>
  <div class="admin-page">
    <AdminNav :podcast-slug="podcastSlug" />
    <div class="container">
      <div class="page-header">
        <div class="page-header-row">
          <NuxtLink :to="`/podcasts/${podcastSlug}/preview`" class="back-link">← Back to preview</NuxtLink>
          <PreviewViewToggle v-model="viewMode" />
        </div>
      </div>

      <div v-if="loadError" class="error-msg">{{ loadError }}</div>

      <div v-if="episode && podcast" :class="['preview-frame', { mobile: viewMode === 'mobile' }]">
        <div class="preview-screen">
        <article class="ep-detail">
          <div class="ep-art">
            <img v-if="artUrl" :src="artUrl" :alt="episode.title" />
            <div v-else class="ep-art-placeholder">No artwork</div>
          </div>

          <h1 class="ep-title">{{ episode.title }}</h1>
          <p class="ep-show">{{ podcast.title }}</p>

          <div class="ep-meta">
            <span v-if="numberDisplay" class="ep-num">{{ numberDisplay }}</span>
            <span v-if="episode.published_at" class="ep-date" :class="{ scheduled: episode.status === 'scheduled' }">
              {{ episode.status === 'scheduled' ? 'Scheduled ' : '' }}{{ formatDate(episode.published_at) }}
            </span>
            <span v-if="episode.audio_duration_seconds" class="ep-duration">{{ formatDurationShort(episode.audio_duration_seconds) }}</span>
            <span v-if="episode.status !== 'published'" :class="['ep-status-badge', episode.status]">{{ episode.status }}</span>
          </div>

          <div v-if="episode.audio_url" class="ep-player">
            <audio ref="audioEl" :src="episode.audio_url" controls preload="metadata" @timeupdate="onTimeupdate"></audio>
          </div>
          <div v-else class="ep-player-empty">No audio uploaded yet.</div>

          <!-- Chapters -->
          <section v-if="episode.chapters_url" class="panel">
            <header class="panel-header">
              <h2>Chapters <span v-if="chapters.length" class="panel-count">({{ chapters.length }})</span></h2>
              <button type="button" class="panel-collapse" @click="chaptersOpen = !chaptersOpen" :aria-expanded="chaptersOpen">
                {{ chaptersOpen ? 'Hide' : 'Show' }}
              </button>
            </header>
            <div v-if="chaptersOpen" class="panel-body">
              <div v-if="chaptersError" class="panel-error">{{ chaptersError }}</div>
              <div v-else-if="chaptersLoading" class="panel-loading">Loading chapters…</div>
              <ol v-else-if="chapters.length" class="chapter-list">
                <li
                  v-for="(c, i) in chapters"
                  :key="i"
                  :class="['chapter-row', { active: activeChapterIdx === i }]"
                >
                  <button type="button" class="chapter-btn" @click="seek(c.startTime)">
                    <span class="chapter-time">{{ formatChapterTime(c.startTime) }}</span>
                    <span class="chapter-title">{{ c.title }}</span>
                    <a v-if="c.url" :href="c.url" target="_blank" rel="noopener" class="chapter-link" @click.stop :title="c.url">↗</a>
                  </button>
                </li>
              </ol>
              <div v-else class="panel-empty">No chapters in the file.</div>
            </div>
          </section>

          <!-- Transcript -->
          <section v-if="episode.transcript_path" class="panel">
            <header class="panel-header">
              <h2>
                Transcript
                <span v-if="transcript?.synced && transcript.cues.length" class="panel-count">
                  ({{ transcript.cues.length }} cues, synced)
                </span>
                <span v-else-if="transcript && !transcript.synced" class="panel-count">(not synced)</span>
              </h2>
              <button type="button" class="panel-collapse" @click="transcriptOpen = !transcriptOpen" :aria-expanded="transcriptOpen">
                {{ transcriptOpen ? 'Hide' : 'Show' }}
              </button>
            </header>
            <div v-if="transcriptOpen" class="panel-body">
              <div v-if="transcriptError" class="panel-error">{{ transcriptError }}</div>
              <div v-else-if="transcriptLoading" class="panel-loading">Loading transcript…</div>
              <div v-else-if="transcript?.mode === 'html'" class="transcript-static" v-html="transcript.raw || ''"></div>
              <pre v-else-if="transcript?.mode === 'text'" class="transcript-static plain">{{ transcript.raw }}</pre>
              <div v-else-if="transcript?.synced && transcript.cues.length" class="transcript-cues" ref="cuesContainer">
                <button
                  v-for="(cue, i) in transcript.cues"
                  :key="i"
                  type="button"
                  :class="['cue-row', { active: activeCueIdx === i }]"
                  :data-idx="i"
                  @click="seek(cue.startTime)"
                >
                  <span class="cue-time">{{ formatChapterTime(cue.startTime) }}</span>
                  <span v-if="cue.speaker" class="cue-speaker">{{ cue.speaker }}:</span>
                  <span class="cue-body">{{ cue.body }}</span>
                </button>
              </div>
              <div v-else class="panel-empty">Transcript file is empty.</div>
            </div>
          </section>

          <!-- Show notes -->
          <section v-if="episode.description" class="panel">
            <header class="panel-header">
              <h2>Show notes</h2>
              <button type="button" class="panel-collapse" @click="notesOpen = !notesOpen" :aria-expanded="notesOpen">
                {{ notesOpen ? 'Hide' : 'Show' }}
              </button>
            </header>
            <div v-if="notesOpen" class="panel-body episode-notes" v-html="episode.description"></div>
          </section>
        </article>

        <!-- Prev/next nav -->
        <nav class="ep-nav">
          <NuxtLink
            v-if="prevEpisode"
            :to="`/podcasts/${podcastSlug}/preview/${prevEpisode.id}`"
            class="ep-nav-link"
          >
            <span class="ep-nav-arrow">←</span>
            <span class="ep-nav-meta">
              <span class="ep-nav-label">Previous</span>
              <span class="ep-nav-title">{{ prevEpisode.title }}</span>
            </span>
          </NuxtLink>
          <span v-else class="ep-nav-link disabled">
            <span class="ep-nav-arrow">←</span>
            <span class="ep-nav-meta"><span class="ep-nav-label">Previous</span><span class="ep-nav-title">—</span></span>
          </span>

          <NuxtLink
            v-if="nextEpisode"
            :to="`/podcasts/${podcastSlug}/preview/${nextEpisode.id}`"
            class="ep-nav-link right"
          >
            <span class="ep-nav-meta">
              <span class="ep-nav-label">Next</span>
              <span class="ep-nav-title">{{ nextEpisode.title }}</span>
            </span>
            <span class="ep-nav-arrow">→</span>
          </NuxtLink>
          <span v-else class="ep-nav-link right disabled">
            <span class="ep-nav-meta"><span class="ep-nav-label">Next</span><span class="ep-nav-title">—</span></span>
            <span class="ep-nav-arrow">→</span>
          </span>
        </nav>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Episode } from '~/composables/useEpisodes'

definePageMeta({
  middleware: 'auth',
  // Re-mount on episode-id change so prev/next reload the form data and
  // the audio element resets cleanly.
  key: (route) => route.fullPath,
})

interface PodcastForPreview {
  id: number
  slug: string
  title: string
  image_url: string | null
}

const route = useRoute()
const podcastSlug = route.params.slug as string
const episodeId = Number(route.params.id)

const episode = ref<Episode | null>(null)
const podcast = ref<PodcastForPreview | null>(null)
const allEpisodes = ref<Episode[]>([])
const loadError = ref('')
const viewMode = usePreviewViewMode()

try {
  const [pod, eps] = await Promise.all([
    $fetch<PodcastForPreview>(`/api/podcasts/${podcastSlug}`),
    $fetch<Episode[]>(`/api/podcasts/${podcastSlug}/episodes`),
  ])
  podcast.value = pod
  allEpisodes.value = eps
  const found = eps.find((e) => e.id === episodeId)
  if (!found) {
    loadError.value = 'Episode not found.'
  } else {
    episode.value = found
  }
} catch (err: unknown) {
  loadError.value = err instanceof Error ? err.message : 'Failed to load episode'
}

// Composable wants Ref<Episode>, so guard the early-return case above.
const episodeRef = computed(() => episode.value as Episode)
const {
  audioEl, cuesContainer,
  chaptersOpen, chapters, chaptersLoading, chaptersError, activeChapterIdx,
  transcriptOpen, transcript, transcriptLoading, transcriptError, activeCueIdx,
  notesOpen,
  onTimeupdate, seek,
} = useEpisodePreview(episodeRef, podcastSlug, {
  defaultChaptersOpen: true,
  defaultTranscriptOpen: true,
  defaultNotesOpen: true,
})

const artUrl = computed(() => episode.value?.image_url || podcast.value?.image_url || '')

const numberDisplay = computed(() => {
  const ep = episode.value
  if (!ep) return ''
  if (ep.episode_display) return ep.episode_display
  if (ep.season_number != null && ep.episode_number != null) return `S${ep.season_number}E${ep.episode_number}`
  if (ep.episode_number != null) return `Ep ${ep.episode_number}`
  return ''
})

const currentIndex = computed(() => allEpisodes.value.findIndex((e) => e.id === episodeId))
// API returns episodes newest-first; chronologically Prev = older = LATER in
// the array, Next = newer = EARLIER. Walk it backwards.
const prevEpisode = computed(() => {
  const i = currentIndex.value
  return i >= 0 && i < allEpisodes.value.length - 1 ? allEpisodes.value[i + 1] : null
})
const nextEpisode = computed(() => {
  const i = currentIndex.value
  return i > 0 ? allEpisodes.value[i - 1] : null
})

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}
function formatDurationShort(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m} min`
}

useHead({ title: () => `${episode.value?.title || 'Episode'} — Preview — Podshelf Admin` })
</script>

<style scoped>
* { box-sizing: border-box; }

.admin-page {
  min-height: 100vh;
  background: #f7fafc;
  font-family: system-ui, sans-serif;
}

.container {
  max-width: 880px;
  margin: 0 auto;
  padding: 2rem 1.25rem;
}

.page-header { margin-bottom: 1.25rem; }
.page-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.875rem;
}

.back-link {
  color: #667eea;
  text-decoration: none;
  font-size: 0.9rem;
  font-weight: 500;
}
.back-link:hover { text-decoration: underline; }

.error-msg {
  background: #fff5f5;
  border: 1px solid #fc8181;
  color: #c53030;
  padding: 0.875rem 1rem;
  border-radius: 8px;
  margin-bottom: 1rem;
}

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
  padding: 0.75rem;
  -webkit-overflow-scrolling: touch;
}

.ep-detail {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 2rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.preview-frame.mobile .ep-detail {
  border: none;
  padding: 0.75rem 0.5rem;
}

.ep-art {
  width: 280px;
  height: 280px;
  border-radius: 14px;
  overflow: hidden;
  background: #edf2f7;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.12);
  margin-bottom: 1.25rem;
}
.ep-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ep-art-placeholder {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  color: #a0aec0; font-size: 1rem;
}

.ep-title {
  margin: 0 0 0.25rem;
  font-size: 1.4rem;
  color: #1a202c;
  line-height: 1.25;
  font-weight: 700;
}
.ep-show {
  margin: 0 0 0.75rem;
  color: #4c51bf;
  font-size: 0.95rem;
  font-weight: 500;
}

.ep-meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem 0.875rem;
  font-size: 0.8rem;
  color: #718096;
  margin-bottom: 1.25rem;
}
.ep-num {
  font-weight: 600;
  color: #4a5568;
  background: #edf2f7;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
}
.ep-date.scheduled { color: #4c51bf; font-style: italic; }
.ep-duration { font-variant-numeric: tabular-nums; }
.ep-status-badge {
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: capitalize;
}
.ep-status-badge.draft { background: #fef3c7; color: #92400e; }
.ep-status-badge.scheduled { background: #ebf4ff; color: #4c51bf; }

.ep-player {
  width: 100%;
  max-width: 560px;
  margin-bottom: 1.5rem;
}
.ep-player audio { width: 100%; }
.ep-player-empty {
  font-size: 0.85rem;
  color: #a0aec0;
  padding: 0.6rem 0.9rem;
  background: #f7fafc;
  border: 1px dashed #e2e8f0;
  border-radius: 6px;
  margin-bottom: 1.5rem;
  width: 100%;
  max-width: 560px;
  text-align: left;
}

.panel {
  width: 100%;
  text-align: left;
  margin-bottom: 1rem;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
}
.panel:last-of-type { margin-bottom: 0; }
.preview-frame.mobile .panel { border-radius: 8px; }
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 0.75rem 1rem;
  background: #f7fafc;
  border-bottom: 1px solid #e2e8f0;
}
.panel-header h2 {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: #4a5568;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.panel-count {
  color: #a0aec0;
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  margin-left: 0.25rem;
  font-size: 0.78rem;
}
.panel-collapse {
  background: none;
  border: none;
  color: #667eea;
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
  padding: 0.15rem 0.4rem;
  font-family: inherit;
}
.panel-collapse:hover { text-decoration: underline; }
.panel-body { padding: 0.75rem 1rem; font-size: 0.9rem; color: #2d3748; }
.panel-loading { color: #718096; font-size: 0.85rem; }
.panel-empty { color: #a0aec0; font-size: 0.85rem; font-style: italic; }
.panel-error {
  color: #c53030;
  background: #fff5f5;
  border: 1px solid #fc8181;
  padding: 0.5rem 0.75rem;
  border-radius: 5px;
  font-size: 0.82rem;
}

.chapter-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.chapter-row { border-bottom: 1px solid #edf2f7; }
.chapter-row:last-child { border-bottom: none; }
.chapter-row.active .chapter-btn { background: #ebf4ff; color: #4c51bf; }
.chapter-btn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.45rem 0.5rem;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  font-size: 0.88rem;
  color: #2d3748;
  border-radius: 4px;
  transition: background 0.1s;
}
.chapter-btn:hover { background: #edf2f7; }
.chapter-time {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  color: #718096;
  font-size: 0.8rem;
  min-width: 3.75rem;
}
.chapter-row.active .chapter-time { color: #4c51bf; }
.chapter-title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chapter-link {
  flex-shrink: 0;
  color: #667eea;
  text-decoration: none;
  font-size: 0.85rem;
  padding: 0 0.25rem;
}
.chapter-link:hover { text-decoration: underline; }

.transcript-cues {
  max-height: 480px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  scroll-behavior: smooth;
}
.cue-row {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  width: 100%;
  padding: 0.4rem 0.5rem;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.88rem;
  color: #2d3748;
  line-height: 1.55;
  border-radius: 4px;
}
.cue-row:hover { background: #edf2f7; }
.cue-row.active { background: #ebf4ff; color: #2d3748; font-weight: 500; }
.cue-time {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  color: #a0aec0;
  font-size: 0.78rem;
  min-width: 3.75rem;
}
.cue-row.active .cue-time { color: #4c51bf; }
.cue-speaker { flex-shrink: 0; color: #4c51bf; font-weight: 600; }
.cue-body { flex: 1; min-width: 0; white-space: pre-wrap; word-break: break-word; }

.transcript-static {
  max-height: 520px;
  overflow-y: auto;
  font-size: 0.9rem;
  line-height: 1.6;
}
.transcript-static.plain {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-word;
  background: #f7fafc;
  padding: 0.625rem 0.75rem;
  border-radius: 5px;
  border: 1px solid #e2e8f0;
  margin: 0;
  font-size: 0.82rem;
}
.transcript-static :deep(p) { margin: 0 0 0.6rem; }

.episode-notes :deep(p) { margin: 0 0 0.7rem; }
.episode-notes :deep(p:last-child) { margin-bottom: 0; }
.episode-notes :deep(a) { color: #667eea; }
.episode-notes :deep(ul), .episode-notes :deep(ol) { margin: 0 0 0.7rem 1.25rem; }

.ep-nav {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  margin-top: 1.25rem;
}
.ep-nav-link {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  flex: 1;
  max-width: 48%;
  padding: 0.75rem 0.875rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  text-decoration: none;
  color: #2d3748;
  transition: all 0.15s;
}
.ep-nav-link.right {
  flex-direction: row;
  justify-content: flex-end;
  text-align: right;
}
.ep-nav-link:hover:not(.disabled) {
  border-color: #c3dafe;
  background: #f7fafc;
}
.ep-nav-link.disabled {
  color: #cbd5e0;
  cursor: not-allowed;
  background: #f7fafc;
}
.ep-nav-arrow {
  flex-shrink: 0;
  color: #a0aec0;
  font-size: 1.1rem;
}
.ep-nav-link:hover:not(.disabled) .ep-nav-arrow { color: #4c51bf; }
.ep-nav-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.ep-nav-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #a0aec0;
  font-weight: 600;
}
.ep-nav-title {
  font-size: 0.88rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
}

@container preview (max-width: 720px) {
  .ep-art { width: 220px; height: 220px; }
  .ep-title { font-size: 1.2rem; }
}
@container preview (max-width: 420px) {
  .ep-art { width: 180px; height: 180px; }
  .ep-detail { padding: 1rem 0.5rem; }
  .panel-header { padding: 0.55rem 0.75rem; }
  .panel-body { padding: 0.6rem 0.75rem; }
  .ep-nav { flex-direction: column; }
  .ep-nav-link { max-width: 100%; }
  .ep-nav-link.right { flex-direction: row; justify-content: flex-end; }
}
@media (max-width: 720px) {
  .container { padding: 1rem 0.75rem; }
}
</style>
