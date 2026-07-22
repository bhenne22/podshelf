<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

interface Correction {
  id: number
  episode_id: number | null
  episode_slug: string | null
  episode_title: string | null
  timecode: string | null
  claim: string
  correction: string
  source_url: string | null
  submitter_name: string | null
  submitter_contact: string | null
  status: 'new' | 'confirmed' | 'rejected' | 'aired'
  resolution_note: string | null
  aired_episode_id: number | null
  aired_episode_title: string | null
  created_at: string
  updated_at: string
}

interface EpisodeOption {
  id: number
  title: string
  episode_number: number | null
  season_number: number | null
}

const FILTERS = [
  { key: 'new', label: 'New' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'aired', label: 'Aired' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
] as const

const route = useRoute()
const podcastSlug = route.params.slug as string

const corrections = ref<Correction[]>([])
const episodes = ref<EpisodeOption[]>([])
const filter = ref<string>('new')
const loading = ref(true)
const savingId = ref<number | null>(null)
const errorMsg = ref('')
const successMsg = ref('')

// Per-row scratch state so an in-progress note isn't clobbered by a reload.
const drafts = reactive<Record<number, { resolution_note: string; aired_episode_id: string }>>({})

function seedDraft(c: Correction) {
  drafts[c.id] = {
    resolution_note: c.resolution_note ?? '',
    aired_episode_id: c.aired_episode_id ? String(c.aired_episode_id) : '',
  }
}

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    corrections.value = await $fetch<Correction[]>(
      `/api/podcasts/${podcastSlug}/corrections`,
      { query: { status: filter.value } },
    )
    for (const c of corrections.value) seedDraft(c)
  } catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : 'Failed to load corrections'
  } finally {
    loading.value = false
  }
}

async function loadEpisodes() {
  try {
    const rows = await $fetch<EpisodeOption[]>(`/api/podcasts/${podcastSlug}/episodes`)
    episodes.value = rows
  } catch {
    // Non-fatal — the "aired on" picker just stays empty.
  }
}

async function patch(c: Correction, payload: Record<string, unknown>) {
  savingId.value = c.id
  errorMsg.value = ''
  successMsg.value = ''
  try {
    await $fetch(`/api/podcasts/${podcastSlug}/corrections/${c.id}`, {
      method: 'PATCH',
      body: payload,
    })
    successMsg.value = `Correction #${c.id} updated.`
    await load()
  } catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : 'Failed to update correction'
  } finally {
    savingId.value = null
  }
}

function setStatus(c: Correction, status: Correction['status']) {
  patch(c, { status })
}

function saveTriage(c: Correction) {
  const d = drafts[c.id]
  patch(c, {
    resolution_note: d.resolution_note,
    aired_episode_id: d.aired_episode_id === '' ? null : Number(d.aired_episode_id),
  })
}

function episodeLabel(e: EpisodeOption): string {
  const parts: string[] = []
  if (e.season_number) parts.push(`S${e.season_number}`)
  if (e.episode_number) parts.push(`E${e.episode_number}`)
  const prefix = parts.length ? `${parts.join('')} · ` : ''
  return `${prefix}${e.title}`
}

function formatDate(iso: string): string {
  try {
    return new Date(iso.includes('Z') ? iso : iso.replace(' ', 'T') + 'Z')
      .toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return iso
  }
}

watch(filter, load)
onMounted(() => {
  load()
  loadEpisodes()
})
</script>

<template>
  <div class="admin-page">
    <AdminNav :podcast-slug="podcastSlug" />
    <div class="container">
      <h1>Corrections</h1>
      <p class="page-intro">
        Factual errors reported by listeners through the site's corrections form
        (<code>POST /api/public/corrections</code>). Nothing here is public — confirm
        what's real, note it on the next show, then mark it aired. Subscribe a webhook
        to <code>correction.submitted</code> on the Settings page to get pinged in
        Discord when one lands.
      </p>

      <div v-if="successMsg" class="success-msg">{{ successMsg }}</div>
      <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

      <div class="filters">
        <button
          v-for="f in FILTERS"
          :key="f.key"
          type="button"
          class="filter-chip"
          :class="{ active: filter === f.key }"
          @click="filter = f.key"
        >{{ f.label }}</button>
      </div>

      <div v-if="loading" class="loading">Loading…</div>
      <div v-else-if="!corrections.length" class="empty">
        Nothing here. Either we've been flawless or nobody's watching.
      </div>

      <ul v-else class="corr-list">
        <li v-for="c in corrections" :key="c.id" class="corr-row">
          <div class="corr-head">
            <span class="status-badge" :class="`status-${c.status}`">{{ c.status }}</span>
            <span class="corr-where">
              {{ c.episode_title || c.episode_slug || 'No episode specified' }}
              <template v-if="c.timecode"> @ {{ c.timecode }}</template>
            </span>
            <span class="corr-when">{{ formatDate(c.created_at) }}</span>
          </div>

          <dl class="corr-body">
            <dt>We said</dt>
            <dd>{{ c.claim }}</dd>
            <dt>Actually</dt>
            <dd>{{ c.correction }}</dd>
            <template v-if="c.source_url">
              <dt>Source</dt>
              <dd>
                <a :href="c.source_url" target="_blank" rel="noopener noreferrer nofollow">{{ c.source_url }}</a>
              </dd>
            </template>
            <template v-if="c.submitter_name || c.submitter_contact">
              <dt>From</dt>
              <dd>
                {{ c.submitter_name || 'Anonymous' }}
                <span v-if="c.submitter_contact" class="contact">· {{ c.submitter_contact }}</span>
              </dd>
            </template>
          </dl>

          <div class="corr-triage">
            <div class="triage-row">
              <label :for="`note-${c.id}`">Resolution note</label>
              <textarea
                :id="`note-${c.id}`"
                v-model="drafts[c.id].resolution_note"
                rows="2"
                placeholder="What we found when we checked."
              />
            </div>
            <div class="triage-row">
              <label :for="`aired-${c.id}`">Noted on air in</label>
              <select :id="`aired-${c.id}`" v-model="drafts[c.id].aired_episode_id">
                <option value="">— not yet —</option>
                <option v-for="e in episodes" :key="e.id" :value="String(e.id)">
                  {{ episodeLabel(e) }}
                </option>
              </select>
            </div>
            <div class="triage-actions">
              <button type="button" class="btn-secondary" :disabled="savingId === c.id" @click="saveTriage(c)">
                Save note
              </button>
              <button v-if="c.status !== 'confirmed'" type="button" class="btn-primary" :disabled="savingId === c.id" @click="setStatus(c, 'confirmed')">
                Confirm
              </button>
              <button v-if="c.status !== 'aired'" type="button" class="btn-primary" :disabled="savingId === c.id" @click="setStatus(c, 'aired')">
                Mark aired
              </button>
              <button v-if="c.status !== 'rejected'" type="button" class="btn-danger" :disabled="savingId === c.id" @click="setStatus(c, 'rejected')">
                Reject
              </button>
            </div>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

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

h1 {
  margin: 0 0 0.5rem;
  font-size: 1.5rem;
  color: #1a202c;
}

.page-intro {
  color: #4a5568;
  font-size: 0.9rem;
  margin: 0 0 1.5rem;
  line-height: 1.5;
}

.page-intro code {
  background: #edf2f7;
  padding: 0.1em 0.35em;
  border-radius: 3px;
  font-size: 0.85em;
}

.success-msg,
.error-msg {
  padding: 0.75rem 1rem;
  border-radius: 6px;
  font-size: 0.875rem;
  margin-bottom: 1rem;
}

.success-msg { background: #f0fff4; border: 1px solid #9ae6b4; color: #22543d; }
.error-msg { background: #fff5f5; border: 1px solid #feb2b2; color: #742a2a; }

.filters {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 1.25rem;
}

.filter-chip {
  border: 1px solid #e2e8f0;
  background: white;
  color: #4a5568;
  padding: 0.35rem 0.8rem;
  border-radius: 999px;
  font-size: 0.825rem;
  cursor: pointer;
}

.filter-chip:hover { border-color: #cbd5e0; }
.filter-chip.active { background: #2b6cb0; border-color: #2b6cb0; color: white; }

.loading,
.empty {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 1.5rem;
  color: #718096;
  font-size: 0.9rem;
}

.corr-list { list-style: none; margin: 0; padding: 0; }

.corr-row {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 1.25rem;
  margin-bottom: 1rem;
}

.corr-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 0.85rem;
}

.status-badge {
  text-transform: uppercase;
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  font-weight: 600;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
}

.status-new { background: #ebf8ff; color: #2c5282; }
.status-confirmed { background: #fefcbf; color: #744210; }
.status-aired { background: #f0fff4; color: #22543d; }
.status-rejected { background: #edf2f7; color: #4a5568; }

.corr-where { font-weight: 600; color: #1a202c; font-size: 0.9rem; }
.corr-when { margin-left: auto; color: #a0aec0; font-size: 0.8rem; }

.corr-body {
  display: grid;
  grid-template-columns: 7.5rem 1fr;
  gap: 0.35rem 1rem;
  margin: 0 0 1rem;
  font-size: 0.875rem;
}

.corr-body dt {
  color: #718096;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding-top: 0.15rem;
}

.corr-body dd {
  margin: 0;
  color: #2d3748;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.corr-body .contact { color: #718096; }

.corr-triage {
  border-top: 1px solid #edf2f7;
  padding-top: 1rem;
}

.triage-row { margin-bottom: 0.75rem; }

.triage-row label {
  display: block;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #718096;
  margin-bottom: 0.25rem;
}

.triage-row textarea,
.triage-row select {
  width: 100%;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 0.5rem 0.65rem;
  font: inherit;
  font-size: 0.875rem;
  color: #2d3748;
}

.triage-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.btn-primary,
.btn-secondary,
.btn-danger {
  border-radius: 6px;
  padding: 0.45rem 0.9rem;
  font-size: 0.825rem;
  cursor: pointer;
  border: 1px solid transparent;
}

.btn-primary { background: #2b6cb0; color: white; }
.btn-primary:hover:not(:disabled) { background: #2c5282; }
.btn-secondary { background: white; border-color: #e2e8f0; color: #4a5568; }
.btn-secondary:hover:not(:disabled) { border-color: #cbd5e0; }
.btn-danger { background: white; border-color: #feb2b2; color: #c53030; }
.btn-danger:hover:not(:disabled) { background: #fff5f5; }

button:disabled { opacity: 0.55; cursor: not-allowed; }

@media (max-width: 640px) {
  .corr-body { grid-template-columns: 1fr; gap: 0.15rem; }
  .corr-body dt { padding-top: 0.5rem; }
  .corr-when { margin-left: 0; width: 100%; }
}
</style>
