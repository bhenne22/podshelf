<template>
  <article class="episode-card">
    <div class="episode-meta">
      <span v-if="episode.episode_number" class="episode-number">
        Ep. {{ episode.episode_number }}
      </span>
      <span v-if="episode.published_at" class="episode-date">
        {{ formatDate(episode.published_at) }}
      </span>
    </div>
    <h2 class="episode-title">
      <NuxtLink :to="`/episodes/${episode.slug}`">{{ episode.title }}</NuxtLink>
    </h2>
    <p v-if="episode.description" class="episode-description">
      {{ truncate(episode.description, 200) }}
    </p>
    <div class="episode-actions">
      <NuxtLink :to="`/episodes/${episode.slug}`" class="listen-link">
        &#9654; Listen
      </NuxtLink>
      <span v-if="episode.audio_duration_seconds" class="episode-duration">
        {{ formatDuration(episode.audio_duration_seconds) }}
      </span>
    </div>
  </article>
</template>

<script setup lang="ts">
interface Episode {
  id: number
  title: string
  slug: string
  episode_number?: number | null
  season_number?: number | null
  description?: string | null
  audio_url?: string | null
  audio_duration_seconds?: number | null
  published_at?: string | null
  tags?: string | null
}

const props = defineProps<{ episode: Episode }>()

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function truncate(text: string, max: number): string {
  // Strip simple HTML tags
  const plain = text.replace(/<[^>]+>/g, '')
  if (plain.length <= max) return plain
  return plain.slice(0, max).trimEnd() + '…'
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) {
    return `${h}h ${m}m`
  }
  return `${m}m ${s}s`
}
</script>

<style scoped>
.episode-card {
  background: white;
  border: 1px solid #e8e4dc;
  border-radius: 10px;
  padding: 1.5rem;
  transition: box-shadow 0.2s;
}

.episode-card:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

.episode-meta {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 0.5rem;
}

.episode-number {
  font-size: 0.8rem;
  font-weight: 600;
  color: #b7791f;
  background: #fef9c3;
  border-radius: 4px;
  padding: 0.15rem 0.5rem;
}

.episode-date {
  font-size: 0.8rem;
  color: #a0916e;
}

.episode-title {
  margin: 0 0 0.625rem;
  font-size: 1.2rem;
  line-height: 1.4;
}

.episode-title a {
  color: #2d3748;
  text-decoration: none;
}

.episode-title a:hover {
  color: #744210;
  text-decoration: underline;
}

.episode-description {
  margin: 0 0 1rem;
  color: #5a5040;
  font-size: 0.9rem;
  line-height: 1.6;
}

.episode-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.listen-link {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.4rem 0.875rem;
  background: #92400e;
  color: white;
  text-decoration: none;
  border-radius: 999px;
  font-size: 0.875rem;
  font-weight: 500;
  transition: background 0.15s;
}

.listen-link:hover {
  background: #78350f;
}

.episode-duration {
  font-size: 0.8rem;
  color: #a0916e;
}
</style>
