<template>
  <li class="episode-card" :class="{ [`status-${episode.status}`]: true }">
    <div class="episode-thumb">
      <img v-if="thumbUrl" :src="thumbUrl" :alt="episode.title" />
      <div v-else class="episode-thumb-placeholder">—</div>
    </div>
    <div class="episode-body">
      <div class="episode-meta-row">
        <span v-if="numberDisplay" class="episode-num">{{ numberDisplay }}</span>
        <span v-if="episode.published_at" class="episode-date" :class="{ scheduled: episode.status === 'scheduled' }">
          {{ episode.status === 'scheduled' ? 'Scheduled ' : '' }}{{ formatDate(episode.published_at) }}
        </span>
        <span v-if="episode.audio_duration_seconds" class="episode-duration">
          {{ formatDurationShort(episode.audio_duration_seconds) }}
        </span>
        <span v-if="episode.status !== 'published'" :class="['episode-status-badge', episode.status]">
          {{ episode.status }}
        </span>
      </div>
      <h3 class="episode-title">
        <NuxtLink :to="`/podcasts/${podcastSlug}/preview/${episode.id}`" class="episode-title-link">
          {{ episode.title || 'Untitled episode' }}
        </NuxtLink>
      </h3>

      <div v-if="episode.audio_url" class="episode-player">
        <audio ref="audioEl" :src="episode.audio_url" controls preload="none" @timeupdate="onTimeupdate"></audio>
      </div>
      <div v-else class="episode-player-empty">No audio uploaded yet.</div>

      <!-- Chapters -->
      <div v-if="episode.chapters_url" class="panel chapters-panel">
        <button type="button" class="panel-toggle" @click="chaptersOpen = !chaptersOpen">
          {{ chaptersOpen ? '▾' : '▸' }} Chapters
          <span v-if="chapters.length" class="panel-count">({{ chapters.length }})</span>
        </button>
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
                <a
                  v-if="c.url"
                  :href="c.url"
                  target="_blank"
                  rel="noopener"
                  class="chapter-link"
                  @click.stop
                  :title="c.url"
                >↗</a>
              </button>
            </li>
          </ol>
          <div v-else class="panel-empty">No chapters in the file.</div>
        </div>
      </div>

      <!-- Transcript -->
      <div v-if="episode.transcript_path" class="panel transcript-panel">
        <button type="button" class="panel-toggle" @click="transcriptOpen = !transcriptOpen">
          {{ transcriptOpen ? '▾' : '▸' }} Transcript
          <span v-if="transcript?.synced && transcript.cues.length" class="panel-count">
            ({{ transcript.cues.length }} cues, synced)
          </span>
          <span v-else-if="transcript && !transcript.synced" class="panel-count">
            (not synced)
          </span>
        </button>
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
      </div>

      <!-- Show notes -->
      <div v-if="episode.description" class="panel notes-panel">
        <button type="button" class="panel-toggle" @click="notesOpen = !notesOpen">
          {{ notesOpen ? '▾' : '▸' }} Show notes
        </button>
        <div v-if="notesOpen" class="panel-body episode-notes" v-html="episode.description"></div>
      </div>
    </div>
  </li>
</template>

<script setup lang="ts">
import { toRef } from 'vue'
import type { Episode } from '~/composables/useEpisodes'

const props = defineProps<{
  episode: Episode
  podcastSlug: string
  fallbackArtwork: string | null
}>()

const {
  audioEl, cuesContainer,
  chaptersOpen, chapters, chaptersLoading, chaptersError, activeChapterIdx,
  transcriptOpen, transcript, transcriptLoading, transcriptError, activeCueIdx,
  notesOpen,
  onTimeupdate, seek,
} = useEpisodePreview(toRef(props, 'episode'), props.podcastSlug)

const thumbUrl = computed(() => props.episode.image_url || props.fallbackArtwork || '')

const numberDisplay = computed(() => {
  const ep = props.episode
  if (ep.episode_display) return ep.episode_display
  if (ep.season_number != null && ep.episode_number != null) return `S${ep.season_number}E${ep.episode_number}`
  if (ep.episode_number != null) return `Ep ${ep.episode_number}`
  return ''
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
</script>

<style scoped>
.episode-card {
  display: flex;
  gap: 1rem;
  padding: 1rem 0;
  border-bottom: 1px solid #f0f4f8;
  list-style: none;
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
.episode-title-link {
  color: inherit;
  text-decoration: none;
}
.episode-title-link:hover {
  color: #4c51bf;
  text-decoration: underline;
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

.panel { margin-top: 0.25rem; }
.panel-toggle {
  background: none;
  border: none;
  color: #667eea;
  cursor: pointer;
  padding: 0.25rem 0;
  font-size: 0.82rem;
  font-weight: 500;
  font-family: inherit;
}
.panel-toggle:hover { text-decoration: underline; }
.panel-count {
  color: #a0aec0;
  font-weight: 400;
  margin-left: 0.25rem;
}
.panel-body {
  margin-top: 0.4rem;
  padding: 0.75rem 0.875rem;
  background: #f7fafc;
  border-radius: 6px;
  font-size: 0.88rem;
  color: #2d3748;
}
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
  padding: 0.4rem 0.5rem;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  font-size: 0.85rem;
  color: #2d3748;
  border-radius: 4px;
  transition: background 0.1s;
}
.chapter-btn:hover { background: #edf2f7; }
.chapter-time {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  color: #718096;
  font-size: 0.78rem;
  min-width: 3.5rem;
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
  max-height: 320px;
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
  padding: 0.35rem 0.5rem;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.85rem;
  color: #2d3748;
  line-height: 1.5;
  border-radius: 4px;
}
.cue-row:hover { background: #edf2f7; }
.cue-row.active { background: #ebf4ff; color: #2d3748; font-weight: 500; }
.cue-time {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  color: #a0aec0;
  font-size: 0.75rem;
  min-width: 3.5rem;
}
.cue-row.active .cue-time { color: #4c51bf; }
.cue-speaker { flex-shrink: 0; color: #4c51bf; font-weight: 600; }
.cue-body { flex: 1; min-width: 0; white-space: pre-wrap; word-break: break-word; }

.transcript-static {
  max-height: 400px;
  overflow-y: auto;
  font-size: 0.88rem;
  line-height: 1.55;
}
.transcript-static.plain {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-word;
  background: white;
  padding: 0.5rem 0.75rem;
  border-radius: 5px;
  border: 1px solid #e2e8f0;
  margin: 0;
}
.transcript-static :deep(p) { margin: 0 0 0.5rem; }

.episode-notes :deep(p) { margin: 0 0 0.6rem; }
.episode-notes :deep(p:last-child) { margin-bottom: 0; }
.episode-notes :deep(a) { color: #667eea; }
.episode-notes :deep(ul), .episode-notes :deep(ol) { margin: 0 0 0.6rem 1.25rem; }

@container preview (max-width: 720px) {
  .episode-card { gap: 0.75rem; }
  .episode-thumb { width: 56px; height: 56px; }
  .transcript-cues { max-height: 260px; }
}
</style>
