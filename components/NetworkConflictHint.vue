<template>
  <div v-if="visible" class="conflict-hint">
    <div class="conflict-hint-head">
      <span class="conflict-hint-icon" aria-hidden="true">⚠</span>
      <span class="conflict-hint-label">
        <strong>Heads up</strong> — within ±{{ windowDays }} days of this slot,
        {{ episodes.length }}
        {{ episodes.length === 1 ? 'sibling episode is' : 'sibling episodes are' }}
        already scheduled:
      </span>
    </div>
    <ul class="conflict-hint-list">
      <li v-for="ep in episodes" :key="ep.episode_id">
        <strong>{{ ep.podcast_title }}</strong> — {{ ep.episode_title }}
        <span class="conflict-hint-when">
          ({{ formatWhen(ep.published_at || '', ep.podcast_timezone) }}, {{ ep.status }})
        </span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { NetworkListItem, NetworkUpcomingEpisode } from '~/composables/useNetworks'

const props = defineProps<{
  podcastSlug: string
  publishAt: string | null
}>()

const windowDays = 3
const networks = ref<NetworkListItem[]>([])
const episodes = ref<NetworkUpcomingEpisode[]>([])
const debounceTimer = ref<ReturnType<typeof setTimeout> | null>(null)

const { listNetworks, getUpcomingEpisodes } = useNetworks()

onMounted(async () => {
  try {
    networks.value = await listNetworks({ podcastSlug: props.podcastSlug })
  } catch {
    networks.value = []
  }
  if (networks.value.length > 0 && props.publishAt) {
    runQuery(props.publishAt)
  }
})

watch(
  () => props.publishAt,
  (next) => {
    if (debounceTimer.value) clearTimeout(debounceTimer.value)
    if (networks.value.length === 0) return
    if (!next) {
      episodes.value = []
      return
    }
    debounceTimer.value = setTimeout(() => runQuery(next), 400)
  },
)

onBeforeUnmount(() => {
  if (debounceTimer.value) clearTimeout(debounceTimer.value)
})

async function runQuery(publishAt: string) {
  const parsed = new Date(publishAt)
  if (Number.isNaN(parsed.getTime())) {
    episodes.value = []
    return
  }
  const fromMs = parsed.getTime() - windowDays * 24 * 60 * 60 * 1000
  const toMs = parsed.getTime() + windowDays * 24 * 60 * 60 * 1000
  const from = new Date(fromMs).toISOString()
  const to = new Date(toMs).toISOString()

  const results: NetworkUpcomingEpisode[] = []
  await Promise.all(
    networks.value.map(async (n) => {
      try {
        const eps = await getUpcomingEpisodes(n.slug, {
          from,
          to,
          excludePodcast: props.podcastSlug,
        })
        results.push(...eps)
      } catch {
        // network may have become inaccessible mid-session; skip silently
      }
    }),
  )

  const dedup = new Map<number, NetworkUpcomingEpisode>()
  for (const ep of results) dedup.set(ep.episode_id, ep)
  // The endpoint guarantees published_at is non-null in the conflict-hint
  // branch (no ?include=recording), but the unified type permits null —
  // coerce to '' rather than non-null-assert so we never sort-throw.
  episodes.value = [...dedup.values()].sort((a, b) =>
    (a.published_at || '').localeCompare(b.published_at || ''),
  )
}

const visible = computed(() => episodes.value.length > 0)

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
</script>

<style scoped>
.conflict-hint {
  margin-top: 0.75rem;
  padding: 0.75rem 1rem;
  background: #fffbeb;
  border: 1px solid #fcd34d;
  border-left: 3px solid #f59e0b;
  border-radius: 6px;
  font-size: 0.9rem;
  color: #78350f;
}
.conflict-hint-head {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}
.conflict-hint-icon {
  color: #d97706;
  font-size: 1rem;
  line-height: 1.4;
  flex-shrink: 0;
}
.conflict-hint-label strong {
  color: #92400e;
}
.conflict-hint-list {
  margin: 0.5rem 0 0;
  padding-left: 1.75rem;
  list-style: disc;
}
.conflict-hint-list li {
  margin: 0.15rem 0;
  line-height: 1.4;
}
.conflict-hint-when {
  color: #92400e;
  opacity: 0.8;
}
</style>
