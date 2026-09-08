<template>
  <div class="admin-page">
    <AdminNav />
    <div class="container">
      <div class="page-header">
        <div>
          <NuxtLink :to="`/networks/${slug}`" class="back-link">← {{ network?.title || 'Network' }}</NuxtLink>
          <h1>All episodes</h1>
          <p class="page-sub">
            Every episode across the network, newest first. The
            <strong>ID</strong> is the Podshelf episode id — it's global across
            podcasts, and it's what logs, webhooks and the API refer to.
          </p>
        </div>
      </div>

      <div class="filters">
        <label class="field search">
          <span class="field-label">Search</span>
          <input
            v-model="q"
            type="search"
            placeholder="Title, or paste an episode ID (e.g. 975)"
            @keyup.enter="reload(0)"
          />
        </label>

        <label class="field">
          <span class="field-label">Podcast</span>
          <select v-model="podcast">
            <option value="">All podcasts</option>
            <option v-for="p in network?.podcasts || []" :key="p.id" :value="p.slug">
              {{ p.title }}
            </option>
          </select>
        </label>

        <label class="field">
          <span class="field-label">Status</span>
          <select v-model="status">
            <option value="">Any status</option>
            <option value="published">Published</option>
            <option value="scheduled">Scheduled</option>
            <option value="draft">Draft</option>
          </select>
        </label>

        <button
          v-if="q || podcast || status"
          type="button"
          class="btn-secondary"
          @click="clearFilters"
        >Clear</button>
      </div>

      <div v-if="pending" class="loading">Loading episodes…</div>
      <div v-else-if="error" class="error-box">{{ error }}</div>
      <div v-else-if="!episodes.length" class="empty">
        No episodes match the current filters.
      </div>

      <template v-else>
        <p class="result-count">
          {{ total }} episode{{ total === 1 ? '' : 's' }}<span v-if="total > episodes.length">
            — showing {{ offset + 1 }}–{{ offset + episodes.length }}</span>
        </p>

        <div class="table-wrap"><table class="episodes-table">
          <thead>
            <tr>
              <th scope="col" title="Podshelf episode ID — global across podcasts">ID</th>
              <th scope="col">Podcast</th>
              <th scope="col">Title</th>
              <th scope="col" title="Season / episode number within the show">S/E</th>
              <th scope="col">Status</th>
              <th scope="col">Published</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="ep in episodes" :key="ep.episode_id">
              <td class="col-id" data-label="ID">
                <button
                  type="button"
                  class="id-chip"
                  :title="copiedId === ep.episode_id ? 'Copied' : 'Copy ID'"
                  @click="copyId(ep.episode_id)"
                >{{ copiedId === ep.episode_id ? '✓' : ep.episode_id }}</button>
              </td>
              <td class="col-show" data-label="Podcast">
                <img
                  v-if="ep.podcast_image_url"
                  :src="ep.podcast_image_url"
                  :alt="ep.podcast_title"
                  class="row-art"
                />
                <div v-else class="row-art placeholder" />
                <span class="show-name">{{ ep.podcast_title }}</span>
              </td>
              <td class="col-title" data-label="Title">
                <NuxtLink
                  v-if="memberPodcastSlugs.has(ep.podcast_slug)"
                  :to="`/podcasts/${ep.podcast_slug}/episodes/${ep.episode_id}`"
                  class="ep-title"
                >{{ ep.episode_title || 'Untitled episode' }}</NuxtLink>
                <span v-else class="ep-title is-static">{{ ep.episode_title || 'Untitled episode' }}</span>
              </td>
              <td class="col-num" data-label="S/E">
                <span v-if="ep.season_number || ep.episode_number" class="ep-num">
                  {{ ep.season_number ? `S${ep.season_number}` : '' }}{{ ep.episode_number ? `E${ep.episode_number}` : '' }}
                </span>
                <span v-else class="ep-num draft">—</span>
              </td>
              <td class="col-status" data-label="Status">
                <span class="status-badge" :class="`status-${ep.status}`">{{ ep.status }}</span>
              </td>
              <td class="col-date" data-label="Published">
                {{ formatDate(ep.published_at, ep.podcast_timezone) }}
              </td>
            </tr>
          </tbody>
        </table></div>

        <div v-if="total > limit" class="pager">
          <button type="button" class="btn-secondary" :disabled="offset === 0" @click="reload(offset - limit)">
            ← Previous
          </button>
          <span class="pager-info">Page {{ Math.floor(offset / limit) + 1 }} of {{ Math.ceil(total / limit) }}</span>
          <button
            type="button"
            class="btn-secondary"
            :disabled="offset + limit >= total"
            @click="reload(offset + limit)"
          >Next →</button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { NetworkDetail, NetworkEpisode } from '~/composables/useNetworks'

definePageMeta({ middleware: 'auth' })

const route = useRoute()
const slug = computed(() => route.params.slug as string)

interface AccessiblePodcast { slug: string }

const { data: network } = await useFetch<NetworkDetail>(() => `/api/networks/${slug.value}`)

// `/api/podcasts` returns only podcasts the caller can access; rows outside
// that set render as plain text rather than dead links.
const { data: accessiblePodcasts } = await useFetch<AccessiblePodcast[]>('/api/podcasts')
const memberPodcastSlugs = computed(
  () => new Set((accessiblePodcasts.value || []).map((p) => p.slug)),
)

const { listEpisodes } = useNetworks()

const q = ref('')
const podcast = ref('')
const status = ref('')
const limit = 100
const offset = ref(0)
const total = ref(0)
const episodes = ref<NetworkEpisode[]>([])
// Starts true: rows are fetched in onMounted, which never runs during SSR, so
// a false default renders "No episodes match the current filters" on the
// server and flashes it before the first client fetch lands.
const pending = ref(true)
const error = ref('')
const copiedId = ref<number | null>(null)

async function reload(newOffset = 0) {
  offset.value = Math.max(newOffset, 0)
  pending.value = true
  error.value = ''
  try {
    const res = await listEpisodes(slug.value, {
      q: q.value || undefined,
      podcast: podcast.value || undefined,
      status: (status.value || undefined) as NetworkEpisode['status'] | undefined,
      limit,
      offset: offset.value,
    })
    episodes.value = res.episodes
    total.value = res.total
  } catch (e: unknown) {
    error.value = (e as { statusMessage?: string })?.statusMessage || 'Failed to load episodes'
    episodes.value = []
    total.value = 0
  } finally {
    pending.value = false
  }
}

function clearFilters() {
  q.value = ''
  podcast.value = ''
  status.value = ''
  reload(0)
}

// Debounced so typing a title doesn't fire a query per keystroke; the
// dropdowns re-query immediately since they're single discrete choices.
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(q, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => reload(0), 300)
})
watch([podcast, status], () => reload(0))

onMounted(() => reload(0))

async function copyId(id: number) {
  try {
    await navigator.clipboard.writeText(String(id))
    copiedId.value = id
    setTimeout(() => {
      if (copiedId.value === id) copiedId.value = null
    }, 1200)
  } catch {
    // Clipboard can be unavailable (insecure context, permissions). The id is
    // rendered as text either way, so selecting it by hand still works.
  }
}

function formatDate(iso: string | null, tz: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  try {
    return d.toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', timeZone: tz || 'UTC',
    })
  } catch {
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  }
}
</script>

<style scoped>
.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem 1.5rem 4rem;
}

.page-header { margin-bottom: 1.5rem; }
.back-link {
  display: inline-block;
  margin-bottom: 0.5rem;
  color: #64748b;
  text-decoration: none;
  font-size: 0.875rem;
}
.back-link:hover { color: #334155; }
h1 { margin: 0 0 0.35rem; font-size: 1.6rem; color: #0f172a; }
.page-sub { margin: 0; color: #64748b; font-size: 0.875rem; max-width: 60ch; }
.page-sub strong { color: #334155; }

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: flex-end;
  margin-bottom: 1.25rem;
  padding: 1rem;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}
.field { display: flex; flex-direction: column; gap: 0.25rem; }
.field.search { flex: 1 1 22rem; }
.field-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.field input,
.field select {
  padding: 0.5rem 0.65rem;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 0.9rem;
  background: #fff;
  color: #0f172a;
}
.field input:focus,
.field select:focus { outline: 2px solid #6366f1; outline-offset: -1px; }

.btn-secondary {
  padding: 0.5rem 0.9rem;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
  color: #334155;
  font-size: 0.875rem;
  cursor: pointer;
}
.btn-secondary:hover:not(:disabled) { background: #f1f5f9; }
.btn-secondary:disabled { opacity: 0.45; cursor: default; }

.result-count { margin: 0 0 0.6rem; color: #64748b; font-size: 0.8125rem; }

/* Horizontal scroll lives on the wrapper, never the row, so the sticky
   header and any future row menu aren't clipped. */
.table-wrap { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 8px; }
.episodes-table { width: 100%; border-collapse: collapse; background: #fff; font-size: 0.875rem; }
.episodes-table th {
  text-align: left;
  padding: 0.6rem 0.75rem;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  font-size: 0.75rem;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  white-space: nowrap;
}
.episodes-table td {
  padding: 0.55rem 0.75rem;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: middle;
}
.episodes-table tbody tr:last-child td { border-bottom: none; }
.episodes-table tbody tr:hover { background: #f8fafc; }

.col-id { width: 1%; white-space: nowrap; }
.id-chip {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8125rem;
  color: #475569;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 5px;
  padding: 0.15rem 0.45rem;
  cursor: pointer;
  min-width: 3.5ch;
}
.id-chip:hover { background: #e2e8f0; color: #0f172a; }

.col-show { white-space: nowrap; }
.row-art {
  width: 22px; height: 22px;
  border-radius: 4px;
  object-fit: cover;
  vertical-align: middle;
  margin-right: 0.45rem;
}
.row-art.placeholder { display: inline-block; background: #e2e8f0; }
.show-name { color: #475569; }

.col-title { min-width: 18rem; }
.ep-title { color: #1e293b; text-decoration: none; font-weight: 500; }
.ep-title:hover { color: #4f46e5; text-decoration: underline; }
.ep-title.is-static { color: #64748b; font-weight: 400; }

.col-num { white-space: nowrap; }
.ep-num { font-variant-numeric: tabular-nums; color: #475569; }
.ep-num.draft { color: #cbd5e1; }

.col-date { white-space: nowrap; color: #64748b; }

.status-badge {
  display: inline-block;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.status-published { background: #dcfce7; color: #166534; }
.status-scheduled { background: #fef3c7; color: #92400e; }
.status-draft { background: #f1f5f9; color: #475569; }

.pager {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-top: 1rem;
  justify-content: center;
}
.pager-info { color: #64748b; font-size: 0.8125rem; }

.loading, .empty {
  padding: 2rem;
  text-align: center;
  color: #64748b;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}
.error-box {
  padding: 1rem;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  color: #b91c1c;
}

@media (max-width: 760px) {
  .episodes-table thead { display: none; }
  .episodes-table, .episodes-table tbody, .episodes-table tr, .episodes-table td { display: block; width: 100%; }
  .episodes-table tr {
    border-bottom: 1px solid #e2e8f0;
    padding: 0.5rem 0;
  }
  .episodes-table td { border: none; padding: 0.25rem 0.75rem; }
  .episodes-table td::before {
    content: attr(data-label) ": ";
    font-size: 0.6875rem;
    font-weight: 600;
    color: #94a3b8;
    text-transform: uppercase;
  }
  .col-title { min-width: 0; }
}
</style>
