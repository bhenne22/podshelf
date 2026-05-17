<template>
  <div class="admin-page">
    <AdminNav />
    <div class="container">
      <div v-if="networkPending" class="loading">Loading…</div>

      <template v-else-if="network">
        <div class="page-header">
          <div>
            <NuxtLink to="/networks" class="back-link">← All networks</NuxtLink>
            <h1>{{ network.title }}</h1>
            <p v-if="network.description" class="network-desc">{{ network.description }}</p>
          </div>
          <NuxtLink v-if="me?.is_admin" :to="`/admin/networks/${network.id}`" class="btn-secondary">
            Manage roster
          </NuxtLink>
        </div>

        <section class="roster-section">
          <h2 class="section-heading">Podcasts in this network</h2>
          <ul v-if="network.podcasts.length" class="roster">
            <li v-for="p in network.podcasts" :key="p.id" class="roster-tile">
              <NuxtLink
                v-if="memberPodcastSlugs.has(p.slug)"
                :to="`/podcasts/${p.slug}/episodes`"
                class="roster-link"
              >
                <img v-if="p.image_url" :src="p.image_url" :alt="p.title" class="roster-art" />
                <div v-else class="roster-art placeholder" />
                <span class="roster-title">{{ p.title }}</span>
              </NuxtLink>
              <div v-else class="roster-link is-static">
                <img v-if="p.image_url" :src="p.image_url" :alt="p.title" class="roster-art" />
                <div v-else class="roster-art placeholder" />
                <span class="roster-title">{{ p.title }}</span>
              </div>
            </li>
          </ul>
          <div v-else class="empty">
            This network has no podcasts yet.
            <NuxtLink v-if="me?.is_admin" :to="`/admin/networks/${network.id}`">Add some →</NuxtLink>
          </div>
        </section>

        <SchedulePanel scope-type="network" :scope-slug="slug" />

        <section v-if="network.podcasts.length" class="timeline-section">
          <div class="timeline-head">
            <h2 class="section-heading">Recent &amp; upcoming episodes</h2>
            <div class="window-toggle" role="tablist" aria-label="Time window">
              <button
                v-for="opt in windowOptions"
                :key="opt.days"
                type="button"
                role="tab"
                :aria-selected="windowDays === opt.days"
                :class="{ active: windowDays === opt.days }"
                @click="windowDays = opt.days"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <div v-if="episodesPending" class="loading">Loading episodes…</div>
          <div v-else-if="!buckets.length" class="empty">
            No recent or upcoming episodes in this window.
          </div>
          <div v-else class="weeks">
            <div v-for="bucket in buckets" :key="bucket.label" class="week">
              <h3 class="week-label">{{ bucket.label }}</h3>
              <ul class="episode-rows">
                <li
                  v-for="ev in bucket.events"
                  :key="`${ev.ep.episode_id}-${ev.kind}`"
                  class="episode-row"
                  :class="`event-${ev.kind}`"
                >
                  <img
                    v-if="ev.ep.podcast_image_url"
                    :src="ev.ep.podcast_image_url"
                    :alt="ev.ep.podcast_title"
                    class="row-art"
                  />
                  <div v-else class="row-art placeholder" />
                  <div class="row-body">
                    <div class="row-title">
                      <span class="event-kind" :class="`event-kind-${ev.kind}`">
                        {{ ev.kind === 'recording' ? 'REC' : 'DROP' }}
                      </span>
                      <span class="row-show">{{ ev.ep.podcast_title }}</span>
                      <span class="row-sep">·</span>
                      <NuxtLink
                        v-if="memberPodcastSlugs.has(ev.ep.podcast_slug)"
                        :to="`/podcasts/${ev.ep.podcast_slug}/episodes/${ev.ep.episode_id}`"
                        class="row-ep-link"
                      >
                        {{ ev.ep.episode_title }}
                      </NuxtLink>
                      <span v-else>{{ ev.ep.episode_title }}</span>
                    </div>
                    <div class="row-meta">
                      <span class="row-when">{{ formatWhen(ev.at, ev.ep.podcast_timezone) }}</span>
                      <span
                        v-if="ev.kind === 'recording' && ev.duration_minutes"
                        class="row-when"
                      >· {{ ev.duration_minutes }} min</span>
                      <span
                        v-if="ev.kind === 'publish'"
                        class="status-badge"
                        :class="`status-${ev.ep.status}`"
                      >{{ ev.ep.status }}</span>
                    </div>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { NetworkDetail, NetworkUpcomingEpisode } from '~/composables/useNetworks'

definePageMeta({ middleware: 'auth' })

const route = useRoute()
const slug = computed(() => route.params.slug as string)

interface Me { id: number; email: string; is_admin: boolean }
interface AccessiblePodcast { slug: string }

const { data: me } = await useFetch<Me>('/api/me')

const { data: network, pending: networkPending } = await useFetch<NetworkDetail>(
  () => `/api/networks/${slug.value}`,
)

// `/api/podcasts` returns only podcasts the caller can access; we use that
// set to decide which roster tiles and episode rows should be links.
const { data: accessiblePodcasts } = await useFetch<AccessiblePodcast[]>('/api/podcasts')
const memberPodcastSlugs = computed(
  () => new Set((accessiblePodcasts.value || []).map((p) => p.slug)),
)

const windowOptions = [
  { days: 30, label: '30d' },
  { days: 60, label: '60d' },
  { days: 90, label: '90d' },
]
const windowDays = ref(60)

const episodes = ref<NetworkUpcomingEpisode[]>([])
const episodesPending = ref(false)

const { getUpcomingEpisodes } = useNetworks()

// Fixed 14-day lookback for "what just dropped" context; the window selector
// controls forward planning horizon. Most "did anyone publish in the last
// couple weeks?" questions don't benefit from a longer rear-view.
const LOOKBACK_DAYS = 14

async function loadEpisodes() {
  if (!network.value) return
  episodesPending.value = true
  try {
    const now = new Date()
    const from = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const to = new Date(now.getTime() + windowDays.value * 24 * 60 * 60 * 1000).toISOString()
    // include=recording widens the response to bring in REC events. Each
    // episode may produce 1 or 2 timeline entries below; the endpoint
    // still returns one row per episode.
    episodes.value = await getUpcomingEpisodes(slug.value, { from, to, include: 'recording' })
  } catch {
    episodes.value = []
  } finally {
    episodesPending.value = false
  }
}

watch([network, windowDays], () => {
  if (network.value) loadEpisodes()
}, { immediate: true })

// One timeline event per render row. An episode with both a publish date
// and a recording slot produces two events; either kind alone produces one.
// Carrying the full episode lets the template reuse the existing link/art
// rendering without per-kind duplication.
interface TimelineEvent {
  kind: 'publish' | 'recording'
  at: string
  ep: NetworkUpcomingEpisode
  duration_minutes?: number | null
}

interface Bucket { label: string; events: TimelineEvent[] }

const timelineEvents = computed<TimelineEvent[]>(() => {
  const out: TimelineEvent[] = []
  for (const ep of episodes.value) {
    if (ep.published_at) {
      out.push({ kind: 'publish', at: ep.published_at, ep })
    }
    if (ep.recording_starts_at) {
      out.push({
        kind: 'recording',
        at: ep.recording_starts_at,
        ep,
        duration_minutes: ep.recording_duration_minutes ?? null,
      })
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at))
})

// Group by ISO week (Mon-start). Labels reference the bucket relative to
// "this week" so the timeline reads as a quick scan rather than a date list.
const buckets = computed<Bucket[]>(() => {
  const out: Map<string, Bucket> = new Map()
  const now = new Date()
  const thisWeekStart = startOfWeek(now)
  for (const ev of timelineEvents.value) {
    const d = new Date(ev.at)
    const ws = startOfWeek(d)
    const key = ws.toISOString().slice(0, 10)
    if (!out.has(key)) {
      out.set(key, { label: weekLabel(ws, thisWeekStart), events: [] })
    }
    out.get(key)!.events.push(ev)
  }
  return [...out.values()]
})

function startOfWeek(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  // Monday = 1; convert Sunday (0) to 7 so the offset math always pulls back.
  const day = r.getDay() === 0 ? 7 : r.getDay()
  r.setDate(r.getDate() - (day - 1))
  return r
}

function weekLabel(weekStart: Date, thisWeekStart: Date): string {
  const oneDay = 24 * 60 * 60 * 1000
  const diffDays = Math.round((weekStart.getTime() - thisWeekStart.getTime()) / oneDay)
  if (diffDays === 0) return 'This week'
  if (diffDays === 7) return 'Next week'
  if (diffDays === -7) return 'Last week'
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  const end = new Date(weekStart.getTime() + 6 * oneDay)
  return `Week of ${weekStart.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`
}

function formatWhen(iso: string, tz: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      timeZone: tz,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    })
  } catch {
    return iso
  }
}

useHead({ title: () => (network.value ? `${network.value.title} · Networks` : 'Network') })
</script>

<style scoped>
* { box-sizing: border-box; }

.admin-page {
  min-height: 100vh;
  background: #f7fafc;
  font-family: system-ui, sans-serif;
}

.container {
  max-width: 900px;
  margin: 0 auto;
  padding: 2rem 1.25rem;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 1.5rem;
  gap: 1rem;
}

.back-link {
  display: inline-block;
  margin-bottom: 0.25rem;
  color: #667eea;
  text-decoration: none;
  font-size: 0.85rem;
}
.back-link:hover { text-decoration: underline; }

h1 {
  margin: 0;
  font-size: 1.5rem;
  color: #1a202c;
}

.network-desc {
  margin: 0.5rem 0 0;
  color: #4a5568;
  font-size: 0.95rem;
}

.btn-secondary {
  padding: 0.5rem 1rem;
  background: white;
  color: #4c51bf;
  border: 1px solid #c3dafe;
  border-radius: 6px;
  font-size: 0.875rem;
  text-decoration: none;
  white-space: nowrap;
}
.btn-secondary:hover { background: #ebf4ff; }

.section-heading {
  font-size: 0.78rem;
  font-weight: 600;
  color: #4a5568;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0 0 0.75rem;
}

.roster-section { margin-bottom: 2rem; }

.roster {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.roster-tile {
  display: block;
}

.roster-link {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem 0.5rem 0.5rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  text-decoration: none;
  color: inherit;
  font-size: 0.9rem;
  transition: border-color 0.15s, transform 0.15s;
}
.roster-link:hover {
  border-color: #667eea;
  transform: translateY(-1px);
}
.roster-link.is-static {
  cursor: default;
  opacity: 0.85;
}
.roster-link.is-static:hover {
  border-color: #e2e8f0;
  transform: none;
}

.roster-art {
  width: 36px;
  height: 36px;
  border-radius: 4px;
  object-fit: cover;
  background: #edf2f7;
}
.roster-art.placeholder { background: #edf2f7; }

.roster-title { font-weight: 500; }

.timeline-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 0.5rem;
  gap: 1rem;
}

.window-toggle {
  display: inline-flex;
  background: #edf2f7;
  border-radius: 6px;
  padding: 0.15rem;
  gap: 0.15rem;
}
.window-toggle button {
  background: transparent;
  border: none;
  padding: 0.25rem 0.65rem;
  font-size: 0.8rem;
  color: #4a5568;
  cursor: pointer;
  border-radius: 4px;
  font-family: inherit;
}
.window-toggle button.active {
  background: white;
  color: #4c51bf;
  font-weight: 500;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

.weeks {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.week-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: #4a5568;
  margin: 0 0 0.4rem;
}

.episode-rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.episode-row {
  display: flex;
  gap: 0.75rem;
  padding: 0.65rem 0.85rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.row-art {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  object-fit: cover;
  background: #edf2f7;
  flex-shrink: 0;
}
.row-art.placeholder { background: #edf2f7; }

.row-body {
  flex: 1;
  min-width: 0;
}

.row-title {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem;
  font-size: 0.95rem;
  color: #1a202c;
}
.row-show {
  font-weight: 600;
  color: #1a202c;
}
.row-sep { color: #a0aec0; }
.row-ep-link {
  color: #4c51bf;
  text-decoration: none;
}
.row-ep-link:hover { text-decoration: underline; }

.row-meta {
  margin-top: 0.2rem;
  font-size: 0.8rem;
  color: #718096;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.status-badge {
  display: inline-block;
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.status-scheduled {
  background: #fef5e7;
  color: #b7791f;
  border: 1px solid #f6ad55;
}
.status-published {
  background: #e6fffa;
  color: #2c7a7b;
  border: 1px solid #81e6d9;
}
.status-draft {
  background: #edf2f7;
  color: #4a5568;
  border: 1px solid #cbd5e0;
}

/* REC events get a subtle accent on the row so they're scannable as a
   different beat from publish events. Drops keep the original styling. */
.event-row.event-recording,
.episode-row.event-recording {
  border-left: 3px solid #6b46c1;
}

.event-kind {
  display: inline-block;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 0.05rem 0.4rem;
  border-radius: 3px;
  margin-right: 0.35rem;
  font-family: ui-monospace, monospace;
}
.event-kind-recording {
  background: #faf5ff;
  color: #6b46c1;
  border: 1px solid #d6bcfa;
}
.event-kind-publish {
  background: #ebf8ff;
  color: #2b6cb0;
  border: 1px solid #bee3f8;
}

.loading, .empty {
  text-align: center;
  color: #718096;
  padding: 2rem;
}
.empty a { color: #667eea; margin-left: 0.25rem; }

@media (max-width: 720px) {
  .container { padding: 1rem 0.75rem; }
  .page-header {
    flex-direction: column;
    align-items: stretch;
  }
  .btn-secondary { text-align: center; min-height: 44px; padding: 0.6rem 1rem; }
  .timeline-head {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }
}
</style>
