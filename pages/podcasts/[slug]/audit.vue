<template>
  <div class="admin-page">
    <AdminNav :podcast-slug="podcastSlug" />
    <div class="container">
      <div class="page-head">
        <h1>Audit Log</h1>
        <a
          :href="`/api/podcasts/${podcastSlug}/audit.csv`"
          class="btn-secondary"
          download
        >Download CSV</a>
      </div>
      <p class="page-intro">
        Chronological record of who changed what, scoped to this podcast.
        Visible to all members. Click a row to expand the field-level diff.
      </p>

      <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

      <div v-if="loading && !entries.length" class="loading">Loading…</div>
      <div v-else-if="!entries.length" class="empty">No audit entries yet.</div>

      <ul v-else class="audit-list">
        <li class="audit-row audit-header" aria-hidden="true">
          <span class="audit-time">Time</span>
          <span class="audit-action-head">Action</span>
          <span class="audit-text">Actor &amp; summary</span>
          <span class="audit-chev"></span>
        </li>
        <li v-for="entry in entries" :key="entry.id" class="audit-row">
          <button
            class="audit-summary"
            :class="{ expanded: expanded.has(entry.id) }"
            @click="toggle(entry.id)"
            :aria-expanded="expanded.has(entry.id)"
          >
            <span class="audit-time">{{ formatDate(entry.created_at) }}</span>
            <span class="audit-action" :class="actionClass(entry.action)">{{ entry.action }}</span>
            <span class="audit-text">
              <span class="audit-actor" :title="actorTitle(entry)">{{ actorLabel(entry) }}</span>
              <span class="audit-divider">·</span>
              <span class="audit-msg">{{ entry.summary || entry.action }}</span>
            </span>
            <span v-if="entry.details" class="audit-chev">{{ expanded.has(entry.id) ? '▾' : '▸' }}</span>
          </button>
          <div v-if="expanded.has(entry.id) && entry.details" class="audit-details">
            <div v-if="entry.details.changed && entry.details.changed.length" class="diff-block">
              <h4>Changed fields</h4>
              <table class="diff-table">
                <thead>
                  <tr><th>Field</th><th>Before</th><th>After</th></tr>
                </thead>
                <tbody>
                  <tr v-for="field in entry.details.changed" :key="field">
                    <td><code>{{ field }}</code></td>
                    <td><pre>{{ formatVal(entry.details.before?.[field]) }}</pre></td>
                    <td><pre>{{ formatVal(entry.details.after?.[field]) }}</pre></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else>
              <h4>Details</h4>
              <pre class="json-block">{{ JSON.stringify(entry.details, null, 2) }}</pre>
            </div>
          </div>
        </li>
      </ul>

      <div v-if="hasMore" class="load-more">
        <button class="btn-secondary" :disabled="loading" @click="loadMore">
          {{ loading ? 'Loading…' : 'Load older entries' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

interface AuditEntry {
  id: number
  podcast_id: number | null
  user_id: number | null
  api_key_id: number | null
  action: string
  entity_type: string | null
  entity_id: number | null
  summary: string | null
  details: {
    changed?: string[]
    before?: Record<string, unknown>
    after?: Record<string, unknown>
    [key: string]: unknown
  } | null
  created_at: string
  user_email: string | null
  api_key_label: string | null
}

interface AuditResponse {
  entries: AuditEntry[]
  has_more: boolean
  next_before: number | null
}

const route = useRoute()
const podcastSlug = route.params.slug as string

const entries = ref<AuditEntry[]>([])
const loading = ref(false)
const errorMsg = ref('')
const hasMore = ref(false)
const nextBefore = ref<number | null>(null)
const expanded = ref<Set<number>>(new Set())

async function load(before: number | null = null) {
  loading.value = true
  try {
    const url = `/api/podcasts/${podcastSlug}/audit${before ? `?before=${before}` : ''}`
    const data = await $fetch<AuditResponse>(url)
    if (before === null) {
      entries.value = data.entries
    } else {
      entries.value = entries.value.concat(data.entries)
    }
    hasMore.value = data.has_more
    nextBefore.value = data.next_before
  } catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : 'Failed to load audit log'
  } finally {
    loading.value = false
  }
}

await load()

function loadMore() {
  if (nextBefore.value !== null) load(nextBefore.value)
}

function toggle(id: number) {
  if (expanded.value.has(id)) expanded.value.delete(id)
  else expanded.value.add(id)
  // Trigger reactivity (Set mutation isn't tracked).
  expanded.value = new Set(expanded.value)
}

function formatDate(iso: string): string {
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z')
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string' && v.length > 200) return v.slice(0, 200) + '…'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

// API-key actions credit the key (with the user as a tooltip) so the
// audit log shows automation runs distinctly from human ones.
function actorLabel(entry: AuditEntry): string {
  if (entry.api_key_id) return `🔑 ${entry.api_key_label || `key #${entry.api_key_id}`}`
  return entry.user_email || 'system'
}
function actorTitle(entry: AuditEntry): string {
  if (entry.api_key_id) {
    return `API key${entry.api_key_label ? ` "${entry.api_key_label}"` : ''}`
      + (entry.user_email ? ` (owner: ${entry.user_email})` : '')
  }
  return entry.user_email || 'system'
}

function actionClass(action: string): string {
  if (action.includes('publish') && !action.includes('unpublish')) return 'tag-publish'
  if (action.includes('delete') || action.includes('purge') || action.includes('detach') || action.includes('remove')) return 'tag-danger'
  if (action.includes('create') || action.includes('attach') || action.includes('add') || action.includes('restore')) return 'tag-good'
  return 'tag-neutral'
}

useHead({ title: 'Audit Log — Podshelf Admin' })
</script>

<style scoped>
* { box-sizing: border-box; }

.admin-page {
  min-height: 100vh;
  background: #f7fafc;
  font-family: system-ui, sans-serif;
}

.container {
  max-width: 920px;
  margin: 0 auto;
  padding: 2rem 1.25rem;
}

h1 { margin: 0; font-size: 1.5rem; color: #1a202c; }

.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin: 0 0 0.5rem;
  flex-wrap: wrap;
}

.page-intro {
  margin: 0 0 1.5rem;
  font-size: 0.9rem;
  color: #4a5568;
  line-height: 1.5;
}

.audit-list {
  list-style: none;
  margin: 0;
  padding: 0;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
}

.audit-row { border-bottom: 1px solid #edf2f7; }
.audit-row:last-child { border-bottom: none; }

.audit-summary,
.audit-header {
  /* Action labels go up to ~"podcast.settings.update" (22 chars). The
     200px column fits the longest realistic label without overflowing
     into the actor cell — the original 100px column was the source of
     the overlapping/garbled text on first render. */
  display: grid;
  grid-template-columns: 185px 200px 1fr auto;
  gap: 0.75rem;
  align-items: center;
  width: 100%;
  background: white;
  border: none;
  padding: 0.7rem 1rem;
  text-align: left;
  font-size: 0.85rem;
  color: #2d3748;
  font-family: inherit;
}
.audit-summary { cursor: pointer; }
.audit-summary:hover { background: #f7fafc; }
.audit-summary.expanded { background: #f7fafc; }

.audit-header {
  background: #f7fafc;
  border-bottom: 1px solid #e2e8f0;
  font-size: 0.7rem;
  font-weight: 600;
  color: #718096;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  cursor: default;
}
.audit-header:hover { background: #f7fafc; }

.audit-time {
  font-variant-numeric: tabular-nums;
  color: #718096;
  font-size: 0.78rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.audit-action,
.audit-action-head {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.72rem;
  padding: 0.15rem 0.45rem;
  border-radius: 4px;
  white-space: nowrap;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  /* min-width: 0 + grid-area sizing keeps overflow contained inside
     the column slot rather than visually overlapping the actor cell. */
  min-width: 0;
  justify-self: start;
}
.audit-header .audit-action-head {
  background: transparent;
  font-family: inherit;
  padding: 0;
  text-align: left;
}

.tag-neutral { background: #edf2f7; color: #4a5568; }
.tag-good { background: #f0fff4; color: #276749; }
.tag-publish { background: #ebf4ff; color: #4c51bf; }
.tag-danger { background: #fff5f5; color: #c53030; }

.audit-text {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}

.audit-actor {
  color: #4a5568;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}
.audit-divider { color: #cbd5e0; }
.audit-msg {
  color: #2d3748;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.audit-chev {
  color: #a0aec0;
  font-size: 0.72rem;
}

.audit-details {
  background: #f7fafc;
  padding: 0.75rem 1rem 1rem;
  border-top: 1px solid #edf2f7;
}

.audit-details h4 {
  margin: 0 0 0.5rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: #4a5568;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.diff-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  overflow: hidden;
}
.diff-table th, .diff-table td {
  padding: 0.45rem 0.65rem;
  border-bottom: 1px solid #edf2f7;
  vertical-align: top;
  text-align: left;
}
.diff-table th {
  background: #f7fafc;
  font-weight: 600;
  color: #4a5568;
  font-size: 0.75rem;
}
.diff-table tr:last-child td { border-bottom: none; }
.diff-table code {
  background: #edf2f7;
  padding: 0.1em 0.35em;
  border-radius: 3px;
  font-size: 0.85em;
}
.diff-table pre {
  margin: 0;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.78rem;
  white-space: pre-wrap;
  word-break: break-word;
  color: #2d3748;
}

.json-block {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 0.6rem 0.8rem;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.78rem;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: #2d3748;
}

.load-more {
  margin-top: 1rem;
  display: flex;
  justify-content: center;
}
.btn-secondary {
  padding: 0.5rem 1rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.85rem;
  cursor: pointer;
  color: #4a5568;
}
.btn-secondary:hover { background: #f7fafc; }
button:disabled { opacity: 0.6; cursor: not-allowed; }

.empty { color: #718096; padding: 2rem 0; text-align: center; }
.loading { color: #718096; padding: 2rem 0; }

.error-msg {
  background: #fff5f5;
  border: 1px solid #fc8181;
  color: #c53030;
  padding: 0.875rem 1rem;
  border-radius: 8px;
  margin-bottom: 1rem;
  font-size: 0.9rem;
}

@media (max-width: 720px) {
  .audit-summary {
    grid-template-columns: 1fr auto;
    gap: 0.4rem 0.75rem;
    grid-template-areas:
      "time chev"
      "action action"
      "text text";
  }
  .audit-time { grid-area: time; }
  .audit-action { grid-area: action; justify-self: start; }
  .audit-text { grid-area: text; flex-wrap: wrap; }
  .audit-chev { grid-area: chev; }
  .audit-msg { white-space: normal; }
  /* Header doesn't translate to the stacked mobile layout — each card
     is self-labeled by its own structure. */
  .audit-header { display: none; }
}
</style>
