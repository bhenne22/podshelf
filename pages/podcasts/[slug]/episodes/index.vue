<template>
  <div class="admin-page">
    <AdminNav :podcast-slug="podcastSlug" />
    <div class="container">
      <div class="page-header">
        <h1>Episodes</h1>
        <NuxtLink :to="`/podcasts/${podcastSlug}/episodes/new`" class="btn-primary">+ New Episode</NuxtLink>
      </div>

      <div v-if="loading" class="loading">Loading episodes…</div>

      <div v-else-if="error" class="error-msg">{{ error }}</div>

      <template v-else-if="episodes.length">
        <div class="filter-bar">
          <div class="filter-group">
            <label>Season</label>
            <select v-model="seasonFilter">
              <option value="">All seasons</option>
              <option v-for="s in availableSeasons" :key="s" :value="String(s)">Season {{ s }}</option>
              <option value="none">No season</option>
            </select>
          </div>

          <div class="filter-group">
            <label>Date range</label>
            <select v-model="rangePreset">
              <option value="all">All time</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="year">This year</option>
              <option value="custom">Custom…</option>
            </select>
          </div>

          <template v-if="rangePreset === 'custom'">
            <div class="filter-group">
              <label>From</label>
              <input type="date" v-model="customFrom" />
            </div>
            <div class="filter-group">
              <label>To</label>
              <input type="date" v-model="customTo" />
            </div>
          </template>

          <div class="filter-summary">
            Showing <strong>{{ filteredEpisodes.length }}</strong> of {{ episodes.length }}
            <button v-if="hasActiveFilters" type="button" class="filter-clear" @click="clearFilters">Clear filters</button>
          </div>
        </div>
      </template>

      <div v-if="!loading && !error && !episodes.length" class="empty">
        <p>No episodes yet.</p>
        <div class="empty-actions">
          <NuxtLink :to="`/podcasts/${podcastSlug}/episodes/new`" class="btn-primary">Create your first episode</NuxtLink>
          <NuxtLink :to="`/podcasts/${podcastSlug}/import-rss`" class="btn-secondary">Import from existing RSS feed</NuxtLink>
        </div>
        <p class="empty-hint">Migrating from another host? Import pulls every episode in the feed at once. Available only while this podcast is empty.</p>
      </div>

      <div v-else-if="!loading && !error && !filteredEpisodes.length" class="empty no-match">
        <p>No episodes match the current filters.</p>
        <button type="button" class="btn-secondary" @click="clearFilters">Clear filters</button>
      </div>

      <div v-else-if="!loading && !error" class="table-wrap"><table class="episodes-table">
        <thead>
          <tr>
            <th scope="col" title="Overall episode # — chronological index across all published episodes">Overall</th>
            <th scope="col" title="Season number">Season</th>
            <th scope="col" title="Episode number within the season">Ep</th>
            <th scope="col">Title</th>
            <th scope="col">Status</th>
            <th scope="col">Published</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="ep in filteredEpisodes" :key="ep.id">
            <td class="col-num" data-label="Overall">
              <span v-if="overallNumber.get(ep.id)" class="ep-num overall">{{ overallNumber.get(ep.id) }}</span>
              <span v-else class="ep-num draft">—</span>
            </td>
            <td class="col-num" data-label="Season">
              <span v-if="ep.season_number" class="ep-num season">{{ ep.season_number }}</span>
              <span v-else class="ep-num draft">—</span>
            </td>
            <td class="col-num" data-label="Episode">
              <span v-if="ep.episode_number" class="ep-num">{{ ep.episode_number }}</span>
              <span v-else class="ep-num draft">—</span>
            </td>
            <td class="col-title">
              <NuxtLink :to="`/podcasts/${podcastSlug}/episodes/${ep.id}`" class="ep-title">
                {{ ep.title }}
              </NuxtLink>
            </td>
            <td class="col-status">
              <span :class="['status-badge', ep.status]">{{ ep.status }}</span>
            </td>
            <td class="col-date" data-label="Published">
              {{ ep.published_at ? formatDate(ep.published_at) : '—' }}
            </td>
            <td class="col-actions">
              <NuxtLink :to="`/podcasts/${podcastSlug}/episodes/${ep.id}`" class="action-btn">Edit</NuxtLink>
              <button @click="confirmDelete(ep)" class="action-btn danger">Delete</button>
            </td>
          </tr>
        </tbody>
      </table></div>
    </div>

    <!-- Delete confirmation modal -->
    <div v-if="deleteTarget" class="modal-overlay" @click.self="deleteTarget = null">
      <div class="modal">
        <h3>Delete Episode?</h3>
        <p>Are you sure you want to delete <strong>{{ deleteTarget.title }}</strong>? This cannot be undone.</p>
        <div class="modal-actions">
          <button @click="deleteTarget = null" class="btn-secondary">Cancel</button>
          <button @click="doDelete" class="btn-danger" :disabled="deleting">
            {{ deleting ? 'Deleting…' : 'Delete' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Episode } from '~/composables/useEpisodes'

definePageMeta({ middleware: 'auth' })

const route = useRoute()
const podcastSlug = route.params.slug as string

const { episodes, loading, error, refresh, deleteEpisode } = useEpisodes(podcastSlug)
await refresh()

// Map episode.id -> overall episode # (chronological index over published episodes)
const overallNumber = computed(() => {
  const m = new Map<number, number>()
  const published = episodes.value
    .filter((e) => e.status === 'published' && e.published_at)
    .slice()
    .sort((a, b) => (a.published_at || '').localeCompare(b.published_at || ''))
  published.forEach((ep, i) => m.set(ep.id, i + 1))
  return m
})

const seasonFilter = ref<string>('')
const rangePreset = ref<'all' | '30' | '90' | 'year' | 'custom'>('all')
const customFrom = ref<string>('')
const customTo = ref<string>('')

const availableSeasons = computed(() => {
  const set = new Set<number>()
  for (const ep of episodes.value) {
    if (ep.season_number != null) set.add(ep.season_number)
  }
  return Array.from(set).sort((a, b) => a - b)
})

function dateForFilter(ep: Episode): Date | null {
  const iso = ep.published_at || ep.created_at
  if (!iso) return null
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d
}

const filteredEpisodes = computed(() => {
  let now = new Date()
  let from: Date | null = null
  let to: Date | null = null

  if (rangePreset.value === '30') {
    from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  } else if (rangePreset.value === '90') {
    from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
  } else if (rangePreset.value === 'year') {
    from = new Date(now.getFullYear(), 0, 1)
  } else if (rangePreset.value === 'custom') {
    if (customFrom.value) from = new Date(customFrom.value + 'T00:00:00')
    if (customTo.value) to = new Date(customTo.value + 'T23:59:59')
  }

  return episodes.value.filter((ep) => {
    if (seasonFilter.value === 'none') {
      if (ep.season_number != null) return false
    } else if (seasonFilter.value !== '') {
      if (String(ep.season_number) !== seasonFilter.value) return false
    }
    if (from || to) {
      const d = dateForFilter(ep)
      if (!d) return false
      if (from && d < from) return false
      if (to && d > to) return false
    }
    return true
  })
})

const hasActiveFilters = computed(() =>
  seasonFilter.value !== '' || rangePreset.value !== 'all',
)

function clearFilters() {
  seasonFilter.value = ''
  rangePreset.value = 'all'
  customFrom.value = ''
  customTo.value = ''
}

const deleteTarget = ref<Episode | null>(null)
const deleting = ref(false)

function confirmDelete(ep: Episode) {
  deleteTarget.value = ep
}

async function doDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await deleteEpisode(deleteTarget.value.id)
    deleteTarget.value = null
  } finally {
    deleting.value = false
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

useHead({ title: 'Episodes — Podshelf Admin' })
</script>

<style scoped>
* { box-sizing: border-box; }

.admin-page {
  min-height: 100vh;
  background: #f7fafc;
  font-family: system-ui, sans-serif;
}

.container {
  max-width: 960px;
  margin: 0 auto;
  padding: 2rem 1.25rem;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.5rem;
}

h1 {
  margin: 0;
  font-size: 1.5rem;
  color: #1a202c;
}

.btn-primary {
  display: inline-block;
  padding: 0.5rem 1rem;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-primary:hover {
  background: #5a67d8;
}

.loading, .empty {
  text-align: center;
  color: #718096;
  padding: 3rem;
}

.empty-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: center;
  margin-top: 1rem;
  flex-wrap: wrap;
}

.empty-hint {
  font-size: 0.85rem;
  color: #718096;
  margin-top: 1.25rem;
  max-width: 460px;
  margin-left: auto;
  margin-right: auto;
}

.btn-secondary {
  display: inline-block;
  padding: 0.5rem 1rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  color: #4a5568;
  font-size: 0.875rem;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-secondary:hover {
  border-color: #667eea;
  color: #667eea;
}

.error-msg {
  color: #c53030;
  padding: 1rem;
  background: #fff5f5;
  border-radius: 8px;
}

.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.875rem 1rem;
  align-items: end;
  padding: 0.875rem 1rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  margin-bottom: 1rem;
}
.filter-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.filter-group label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #718096;
  font-weight: 600;
}
.filter-group select,
.filter-group input[type="date"] {
  padding: 0.4rem 0.6rem;
  border: 1px solid #e2e8f0;
  border-radius: 5px;
  font-size: 0.85rem;
  background: white;
  color: #2d3748;
  outline: none;
}
.filter-group select:focus,
.filter-group input[type="date"]:focus {
  border-color: #667eea;
}
.filter-summary {
  margin-left: auto;
  font-size: 0.85rem;
  color: #4a5568;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.filter-clear {
  background: none;
  border: none;
  color: #667eea;
  cursor: pointer;
  font-size: 0.8rem;
  padding: 0;
}
.filter-clear:hover { text-decoration: underline; }
.empty.no-match { padding: 1.5rem; }

.episodes-table {
  width: 100%;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  border-collapse: collapse;
  overflow: hidden;
}

.episodes-table th {
  background: #f7fafc;
  text-align: left;
  padding: 0.75rem 1rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: #718096;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid #e2e8f0;
}

.episodes-table td {
  padding: 0.875rem 1rem;
  border-bottom: 1px solid #f0f4f8;
  vertical-align: middle;
}

.episodes-table tr:last-child td {
  border-bottom: none;
}

.episodes-table tr:hover td {
  background: #f7fafc;
}

.col-num { width: 56px; }
.col-status { width: 110px; }
.col-date { width: 140px; font-size: 0.85rem; color: #718096; }
.col-actions { width: 140px; }

.ep-num {
  display: inline-block;
  min-width: 28px;
  text-align: center;
  padding: 0.2rem 0.5rem;
  background: #edf2f7;
  border-radius: 4px;
  font-size: 0.8rem;
  font-weight: 600;
  color: #4a5568;
}

.ep-num.overall {
  background: #e6fffa;
  color: #2c7a7b;
}
.ep-num.season {
  background: #ebf4ff;
  color: #4c51bf;
}

.ep-num.draft { color: #a0aec0; background: transparent; }

.ep-title {
  color: #2d3748;
  text-decoration: none;
  font-weight: 500;
}

.ep-title:hover {
  color: #667eea;
  text-decoration: underline;
}

.status-badge {
  display: inline-block;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: capitalize;
}

.status-badge.published {
  background: #c6f6d5;
  color: #276749;
}

.status-badge.draft {
  background: #fef3c7;
  color: #92400e;
}

.action-btn {
  display: inline-block;
  padding: 0.3rem 0.65rem;
  border: 1px solid #e2e8f0;
  border-radius: 5px;
  background: white;
  color: #4a5568;
  font-size: 0.8rem;
  text-decoration: none;
  cursor: pointer;
  margin-right: 0.375rem;
  transition: all 0.15s;
}

.action-btn:hover {
  border-color: #667eea;
  color: #667eea;
}

.action-btn.danger {
  font-family: system-ui, sans-serif;
}

.action-btn.danger:hover {
  border-color: #fc8181;
  color: #c53030;
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: white;
  border-radius: 10px;
  padding: 1.75rem;
  max-width: 420px;
  width: 90%;
}

.modal h3 {
  margin: 0 0 0.75rem;
  font-size: 1.1rem;
}

.modal p {
  color: #4a5568;
  font-size: 0.9rem;
  margin: 0 0 1.5rem;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

.btn-secondary {
  padding: 0.5rem 1rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-secondary:hover {
  background: #f7fafc;
}

.btn-danger {
  padding: 0.5rem 1rem;
  background: #e53e3e;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-danger:hover:not(:disabled) {
  background: #c53030;
}

.btn-danger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.table-wrap {
  /* Horizontal scroll on small viewports — preserves all columns. */
  width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  border-radius: 10px;
}

@media (max-width: 720px) {
  .container { padding: 1rem 0.75rem; }
  .page-header {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }
  .page-header .btn-primary {
    text-align: center;
    min-height: 44px;
    padding: 0.6rem 1rem;
  }
  .filter-bar {
    padding: 0.625rem 0.75rem;
    gap: 0.625rem 0.75rem;
  }
  .filter-group select,
  .filter-group input[type="date"] {
    padding: 0.55rem 0.6rem;
    font-size: 0.875rem;
    min-height: 40px;
  }
  .filter-summary {
    margin-left: 0;
    width: 100%;
    justify-content: space-between;
  }
  .filter-clear { padding: 0.4rem 0.5rem; min-height: 36px; }
  .episodes-table th,
  .episodes-table td {
    padding: 0.5rem 0.625rem;
    font-size: 0.85rem;
  }
  .col-num { min-width: 56px; width: auto; }
  .col-status { min-width: 90px; width: auto; }
  .col-date { min-width: 110px; width: auto; }
  .col-actions { min-width: 160px; width: auto; }
  .action-btn {
    padding: 0.5rem 0.625rem;
    font-size: 0.8rem;
    min-height: 38px;
  }
  .episodes-table { min-width: 720px; /* force horizontal scroll instead of cramming */ }
  .modal { padding: 1.25rem; }
  .modal-actions button { min-height: 44px; }
}

@media (max-width: 520px) {
  /* Card layout: rows become stacked cards. Order via flex-direction column
     and `order` so the title sits on top regardless of HTML cell order. */
  .table-wrap {
    overflow-x: visible;
    background: transparent;
    border-radius: 0;
  }
  .episodes-table {
    display: block;
    min-width: 0;
    border: none;
    background: transparent;
    overflow: visible;
  }
  .episodes-table thead { display: none; }
  .episodes-table tbody { display: block; }
  .episodes-table tr {
    display: flex;
    flex-direction: column;
    background: white;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    margin-bottom: 0.625rem;
    padding: 0.875rem 1rem;
  }
  .episodes-table tr:hover td { background: transparent; }
  .episodes-table tr:last-child td { border-bottom: none; }
  .episodes-table td {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0;
    border-bottom: none;
    width: auto;
    min-width: 0;
    font-size: 0.85rem;
  }
  .episodes-table td[data-label]::before {
    content: attr(data-label);
    color: #a0aec0;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
    width: 64px;
    flex-shrink: 0;
  }
  /* Title prominent at the top, no label, full-width. */
  .col-title {
    order: 1;
    padding: 0 0 0.5rem;
    margin-bottom: 0.5rem;
    border-bottom: 1px solid #f0f4f8;
  }
  .col-title .ep-title { font-size: 1rem; font-weight: 600; }
  .col-status { order: 2; }
  .col-status::before {
    content: "Status";
    color: #a0aec0;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
    width: 64px;
    flex-shrink: 0;
  }
  /* Numbers in HTML order: overall, season, episode. */
  .col-num:nth-of-type(1) { order: 3; }
  .col-num:nth-of-type(2) { order: 4; }
  .col-num:nth-of-type(3) { order: 5; }
  .col-date { order: 6; }
  /* Actions row gets full-width buttons stacked. */
  .col-actions {
    order: 7;
    flex-direction: row;
    gap: 0.5rem;
    padding-top: 0.625rem;
    margin-top: 0.5rem;
    border-top: 1px solid #f0f4f8;
  }
  .col-actions .action-btn {
    flex: 1;
    text-align: center;
    padding: 0.625rem 0.75rem;
    font-size: 0.85rem;
    min-height: 40px;
    margin-right: 0;
  }
}
</style>
