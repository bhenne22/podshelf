<template>
  <div class="admin-page">
    <AdminNav />
    <div class="container">
      <NuxtLink to="/admin/networks" class="back-link">← All networks</NuxtLink>

      <div v-if="pending" class="loading">Loading…</div>

      <template v-else-if="network">
        <div class="page-header">
          <h1>{{ network.title }}</h1>
          <button class="btn-danger" :disabled="deleting" @click="confirmDelete = true">Delete network</button>
        </div>

        <p class="dim">
          Public dashboard:
          <NuxtLink :to="`/networks/${network.slug}`" class="mono">/networks/{{ network.slug }}</NuxtLink>
        </p>

        <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>
        <div v-if="successMsg" class="success-msg">{{ successMsg }}</div>

        <section class="card">
          <h2 class="card-heading">Metadata</h2>
          <div class="form-group">
            <label>Title</label>
            <input v-model="meta.title" type="text" />
          </div>
          <div class="form-group">
            <label>Slug</label>
            <input v-model="meta.slug" type="text" />
            <p class="hint">Used in URLs. Must not collide with any podcast slug.</p>
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea v-model="meta.description" rows="3" />
          </div>
          <div class="card-actions">
            <button class="btn-primary" :disabled="savingMeta || !metaDirty" @click="saveMeta">
              {{ savingMeta ? 'Saving…' : 'Save changes' }}
            </button>
          </div>
        </section>

        <section class="card">
          <h2 class="card-heading">Podcasts in this network</h2>
          <p class="hint">
            Order shown here is the order used on the public network dashboard. Soft-deleted podcasts stay
            in the list but are filtered from the dashboard until restored.
          </p>

          <ul v-if="network.podcasts.length" class="roster-list">
            <li v-for="(p, i) in network.podcasts" :key="p.id" class="roster-row-wrap">
              <div class="roster-row">
                <div class="roster-position">
                  <button
                    type="button"
                    class="pos-btn"
                    :disabled="i === 0 || reordering"
                    aria-label="Move up"
                    @click="movePodcast(p, i - 1)"
                  >▲</button>
                  <button
                    type="button"
                    class="pos-btn"
                    :disabled="i === network.podcasts.length - 1 || reordering"
                    aria-label="Move down"
                    @click="movePodcast(p, i + 1)"
                  >▼</button>
                </div>
                <img v-if="p.image_url" :src="p.image_url" :alt="p.title" class="roster-art" />
                <div v-else class="roster-art placeholder" />
                <div class="roster-info">
                  <div class="roster-title">
                    {{ p.title }}
                    <span v-if="p.status !== 'active'" class="status-tag">{{ p.status }}</span>
                  </div>
                  <div class="roster-slug mono">/{{ p.slug }}</div>
                </div>
                <button
                  v-if="definitions.length"
                  type="button"
                  class="btn-expand"
                  :aria-expanded="expandedRows.has(p.id)"
                  @click="toggleExpand(p.id)"
                >
                  {{ expandedRows.has(p.id) ? 'Hide values ▴' : 'Edit values ▾' }}
                </button>
                <button
                  type="button"
                  class="btn-remove"
                  :disabled="removing === p.id"
                  @click="removePodcast(p)"
                >
                  {{ removing === p.id ? 'Removing…' : 'Remove' }}
                </button>
              </div>

              <div v-if="expandedRows.has(p.id) && definitions.length" class="value-grid">
                <div v-for="d in definitions" :key="d.id" class="value-cell">
                  <label class="value-label">
                    {{ d.label }}
                    <span v-if="d.description" class="info-icon" :title="d.description" aria-label="Description">ⓘ</span>
                    <span v-if="d.required" class="required-badge">required</span>
                  </label>
                  <div class="value-controls">
                    <input
                      v-if="d.type === 'string'"
                      :value="stringValue(p.id, d.key)"
                      type="text"
                      @input="onValueInput(p.id, d.key, ($event.target as HTMLInputElement).value)"
                    />
                    <input
                      v-else-if="d.type === 'number'"
                      :value="stringValue(p.id, d.key)"
                      type="number"
                      step="any"
                      @input="onValueInput(p.id, d.key, ($event.target as HTMLInputElement).value)"
                    />
                    <input
                      v-else-if="d.type === 'url'"
                      :value="stringValue(p.id, d.key)"
                      type="url"
                      placeholder="https://…"
                      @input="onValueInput(p.id, d.key, ($event.target as HTMLInputElement).value)"
                    />
                    <template v-else-if="d.type === 'color'">
                      <input
                        :value="hexOrDefault(stringValue(p.id, d.key))"
                        type="color"
                        class="color-swatch"
                        @input="onValueInput(p.id, d.key, ($event.target as HTMLInputElement).value)"
                      />
                      <input
                        :value="stringValue(p.id, d.key)"
                        type="text"
                        class="color-hex"
                        placeholder="#rrggbb"
                        maxlength="7"
                        spellcheck="false"
                        @input="onColorTextInput(p.id, d.key, ($event.target as HTMLInputElement).value)"
                      />
                    </template>
                    <label v-else-if="d.type === 'boolean'" class="bool-toggle">
                      <input
                        type="checkbox"
                        :checked="boolValue(p.id, d.key)"
                        @change="onValueImmediate(p.id, d.key, ($event.target as HTMLInputElement).checked)"
                      />
                      {{ boolValue(p.id, d.key) ? 'true' : 'false' }}
                    </label>
                    <button
                      v-if="valueIsSet(p.id, d.key)"
                      type="button"
                      class="btn-clear"
                      :title="`Clear ${d.key}`"
                      @click="clearValue(p.id, d.key)"
                    >×</button>
                  </div>
                  <span v-if="saveState(p.id, d.key) === 'saving'" class="value-state saving">Saving…</span>
                  <span v-else-if="saveState(p.id, d.key) === 'ok'" class="value-state ok">Saved</span>
                  <span v-else-if="saveState(p.id, d.key) === 'err'" class="value-state err">{{ valueErr(p.id, d.key) }}</span>
                </div>
              </div>
            </li>
          </ul>
          <p v-else class="empty">No podcasts yet. Add one below.</p>

          <div class="add-row">
            <label class="add-label">Add a podcast</label>
            <div class="add-controls">
              <select v-model="podcastToAdd">
                <option :value="null">— Select a podcast —</option>
                <option
                  v-for="p in addablePodcasts"
                  :key="p.id"
                  :value="p.id"
                >
                  {{ p.title }} (/{{ p.slug }})
                </option>
              </select>
              <button
                class="btn-primary"
                :disabled="adding || podcastToAdd === null"
                @click="addPodcast"
              >
                {{ adding ? 'Adding…' : 'Add' }}
              </button>
            </div>
          </div>
        </section>

        <section class="card">
          <h2 class="card-heading">Custom Properties</h2>
          <p class="hint">
            Define extra fields for each podcast in this network. Downstream static-site builds (e.g. a network
            landing page) can read these via <code class="mono">/api/networks/{{ network.slug }}?include=properties</code>.
            Each network's schema is independent.
          </p>

          <table v-if="definitions.length" class="def-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Key</th>
                <th>Type</th>
                <th>Required</th>
                <th>Order</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(d, i) in definitions" :key="d.id">
                <template v-if="editingDefKey === d.key">
                  <td>
                    <input v-model="defEdit.label" type="text" class="inline-input" placeholder="Label" />
                    <textarea
                      v-model="defEdit.description"
                      class="inline-input desc-input"
                      placeholder="Description (shown as tooltip)"
                      rows="2"
                    />
                  </td>
                  <td class="mono">{{ d.key }}</td>
                  <td>
                    <select v-model="defEdit.type" class="inline-input">
                      <option v-for="t in PROPERTY_TYPES" :key="t" :value="t">{{ t }}</option>
                    </select>
                  </td>
                  <td>
                    <input v-model="defEdit.required" type="checkbox" />
                  </td>
                  <td class="dim">{{ d.position }}</td>
                  <td class="def-actions">
                    <button class="btn-link" :disabled="savingDef" @click="saveDef(d)">
                      {{ savingDef ? 'Saving…' : 'Save' }}
                    </button>
                    <button class="btn-link cancel" @click="cancelEdit">Cancel</button>
                  </td>
                </template>
                <template v-else>
                  <td>
                    {{ d.label }}
                    <span v-if="d.description" class="info-icon" :title="d.description" aria-label="Description">ⓘ</span>
                  </td>
                  <td class="mono">{{ d.key }}</td>
                  <td><span class="type-tag">{{ d.type }}</span></td>
                  <td>{{ d.required ? 'yes' : 'no' }}</td>
                  <td class="def-position">
                    <button
                      type="button"
                      class="pos-btn"
                      :disabled="i === 0 || reorderingDef"
                      aria-label="Move up"
                      @click="moveDefinition(d, i - 1)"
                    >▲</button>
                    <button
                      type="button"
                      class="pos-btn"
                      :disabled="i === definitions.length - 1 || reorderingDef"
                      aria-label="Move down"
                      @click="moveDefinition(d, i + 1)"
                    >▼</button>
                  </td>
                  <td class="def-actions">
                    <button class="btn-link" @click="beginEdit(d)">Edit</button>
                    <button class="btn-link danger" @click="deleteDefinition(d)">Delete</button>
                  </td>
                </template>
              </tr>
            </tbody>
          </table>
          <p v-else class="empty">No custom properties defined yet.</p>

          <div class="add-row">
            <label class="add-label">Add a property</label>
            <div class="add-def-grid">
              <input v-model="newDef.key" type="text" placeholder="key (e.g. accentColor)" />
              <input v-model="newDef.label" type="text" placeholder="Label (display name)" />
              <select v-model="newDef.type">
                <option v-for="t in PROPERTY_TYPES" :key="t" :value="t">{{ t }}</option>
              </select>
              <label class="required-toggle">
                <input v-model="newDef.required" type="checkbox" /> required
              </label>
              <button class="btn-primary" :disabled="addingDef || !newDef.key" @click="addDefinition">
                {{ addingDef ? 'Adding…' : 'Add' }}
              </button>
            </div>
            <textarea
              v-model="newDef.description"
              class="add-desc"
              placeholder="Description (optional; shown as a tooltip next to the field name)"
              rows="2"
            />
          </div>
        </section>

        <section class="card">
          <h2 class="card-heading">Webhooks</h2>
          <p class="hint">
            Webhooks defined here fire for every podcast in this network when
            the matching event occurs (in addition to per-podcast webhooks).
            Useful for a single "network operations" channel that watches the
            whole roster.
          </p>
          <WebhookManager :base-url="`/api/admin/networks/${id}/webhooks`" />
        </section>
      </template>
    </div>

    <div v-if="confirmDelete" class="modal-overlay" @click.self="confirmDelete = false">
      <div class="modal">
        <h3>Delete network?</h3>
        <p>
          Delete <strong>{{ network?.title }}</strong>? This removes the network and its podcast roster.
          The podcasts themselves are untouched. This can't be undone.
        </p>
        <div class="modal-actions">
          <button class="btn-secondary" @click="confirmDelete = false">Cancel</button>
          <button class="btn-danger" :disabled="deleting" @click="doDelete">
            {{ deleting ? 'Deleting…' : 'Delete network' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type {
  NetworkPropertyDefinition,
  NetworkPropertyType,
} from '~/composables/useNetworks'

definePageMeta({ middleware: 'admin-only' })

const PROPERTY_TYPES: NetworkPropertyType[] = ['string', 'boolean', 'number', 'url', 'color']

const route = useRoute()
const id = computed(() => Number(route.params.id))

interface RosterPodcast {
  id: number
  slug: string
  title: string
  image_url: string | null
  status: string
  position: number
}
interface NetworkDetail {
  id: number
  slug: string
  title: string
  description: string | null
  created_at: string
  updated_at: string
  podcasts: RosterPodcast[]
}
interface PodcastBrief {
  id: number
  slug: string
  title: string
  image_url: string | null
  status: string
}
interface PropertyEntry {
  podcast_id: number
  podcast_slug: string
  key: string
  value: string | number | boolean | null
  type: NetworkPropertyType
}

const { data: network, pending, refresh } = await useFetch<NetworkDetail>(
  () => `/api/admin/networks/${id.value}`,
)
const { data: allPodcasts, refresh: refreshPodcasts } = await useFetch<PodcastBrief[]>('/api/podcasts')

const definitions = ref<NetworkPropertyDefinition[]>([])
const valuesByPodcast = ref<Map<number, Map<string, string | number | boolean | null>>>(new Map())

async function loadDefinitions() {
  if (!Number.isFinite(id.value)) return
  try {
    definitions.value = await $fetch<NetworkPropertyDefinition[]>(
      `/api/admin/networks/${id.value}/property-definitions`,
    )
  } catch {
    definitions.value = []
  }
}

async function loadValues() {
  if (!network.value?.slug) return
  try {
    const res = await $fetch<{ properties: PropertyEntry[] }>(
      `/api/networks/${network.value.slug}/properties`,
    )
    const map = new Map<number, Map<string, string | number | boolean | null>>()
    for (const row of res.properties) {
      let bucket = map.get(row.podcast_id)
      if (!bucket) {
        bucket = new Map()
        map.set(row.podcast_id, bucket)
      }
      bucket.set(row.key, row.value)
    }
    valuesByPodcast.value = map
  } catch {
    valuesByPodcast.value = new Map()
  }
}

await loadDefinitions()
watch(network, async () => {
  await loadValues()
}, { immediate: true })

const errorMsg = ref('')
const successMsg = ref('')

const meta = reactive({ title: '', slug: '', description: '' })
const metaOriginal = reactive({ title: '', slug: '', description: '' })

watch(network, (n) => {
  if (!n) return
  meta.title = n.title
  meta.slug = n.slug
  meta.description = n.description || ''
  metaOriginal.title = n.title
  metaOriginal.slug = n.slug
  metaOriginal.description = n.description || ''
}, { immediate: true })

const metaDirty = computed(() =>
  meta.title !== metaOriginal.title
  || meta.slug !== metaOriginal.slug
  || meta.description !== metaOriginal.description,
)

const savingMeta = ref(false)
const adding = ref(false)
const removing = ref<number | null>(null)
const reordering = ref(false)
const reorderingDef = ref(false)
const deleting = ref(false)
const confirmDelete = ref(false)
const podcastToAdd = ref<number | null>(null)

const addablePodcasts = computed(() => {
  const inNetwork = new Set((network.value?.podcasts || []).map((p) => p.id))
  return (allPodcasts.value || []).filter((p) => !inNetwork.has(p.id) && p.status === 'active')
})

function clearMessages() {
  errorMsg.value = ''
  successMsg.value = ''
}

function showError(err: unknown, fallback: string) {
  errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage || fallback
}

async function saveMeta() {
  clearMessages()
  savingMeta.value = true
  try {
    await $fetch(`/api/admin/networks/${id.value}`, {
      method: 'PATCH',
      body: {
        title: meta.title.trim(),
        slug: meta.slug.trim(),
        description: meta.description.trim() || null,
      },
    })
    await refresh()
    successMsg.value = 'Saved.'
  } catch (err) {
    showError(err, 'Failed to save')
  } finally {
    savingMeta.value = false
  }
}

async function addPodcast() {
  if (podcastToAdd.value === null) return
  clearMessages()
  adding.value = true
  try {
    await $fetch(`/api/admin/networks/${id.value}/podcasts`, {
      method: 'POST',
      body: { podcast_id: podcastToAdd.value },
    })
    podcastToAdd.value = null
    await refresh()
  } catch (err) {
    showError(err, 'Failed to add podcast')
  } finally {
    adding.value = false
  }
}

async function removePodcast(p: RosterPodcast) {
  if (!confirm(`Remove "${p.title}" from this network?`)) return
  clearMessages()
  removing.value = p.id
  try {
    await $fetch(`/api/admin/networks/${id.value}/podcasts/${p.id}`, {
      method: 'DELETE',
    })
    await refresh()
  } catch (err) {
    showError(err, 'Failed to remove podcast')
  } finally {
    removing.value = null
  }
}

async function movePodcast(p: RosterPodcast, toIndex: number) {
  if (!network.value) return
  const list = network.value.podcasts
  if (toIndex < 0 || toIndex >= list.length) return
  clearMessages()
  reordering.value = true
  const reordered = [...list]
  const fromIndex = reordered.findIndex((x) => x.id === p.id)
  reordered.splice(fromIndex, 1)
  reordered.splice(toIndex, 0, p)
  try {
    for (let i = 0; i < reordered.length; i++) {
      const target = reordered[i]
      if (target.position !== i) {
        await $fetch(`/api/admin/networks/${id.value}/podcasts/${target.id}`, {
          method: 'PATCH',
          body: { position: i },
        })
      }
    }
    await refresh()
  } catch (err) {
    showError(err, 'Failed to reorder')
  } finally {
    reordering.value = false
  }
}

// --- Custom Properties: definitions ---

const newDef = reactive<{
  key: string
  label: string
  description: string
  type: NetworkPropertyType
  required: boolean
}>({
  key: '',
  label: '',
  description: '',
  type: 'string',
  required: false,
})
const addingDef = ref(false)

async function addDefinition() {
  if (!newDef.key.trim()) return
  clearMessages()
  addingDef.value = true
  try {
    await $fetch(`/api/admin/networks/${id.value}/property-definitions`, {
      method: 'POST',
      body: {
        key: newDef.key.trim(),
        label: newDef.label.trim() || newDef.key.trim(),
        description: newDef.description.trim() || null,
        type: newDef.type,
        required: newDef.required,
      },
    })
    newDef.key = ''
    newDef.label = ''
    newDef.description = ''
    newDef.type = 'string'
    newDef.required = false
    await loadDefinitions()
  } catch (err) {
    showError(err, 'Failed to add property')
  } finally {
    addingDef.value = false
  }
}

const editingDefKey = ref<string | null>(null)
const defEdit = reactive<{
  label: string
  description: string
  type: NetworkPropertyType
  required: boolean
}>({
  label: '',
  description: '',
  type: 'string',
  required: false,
})
const savingDef = ref(false)

function beginEdit(d: NetworkPropertyDefinition) {
  editingDefKey.value = d.key
  defEdit.label = d.label
  defEdit.description = d.description ?? ''
  defEdit.type = d.type
  defEdit.required = !!d.required
}

function cancelEdit() {
  editingDefKey.value = null
}

async function saveDef(d: NetworkPropertyDefinition) {
  clearMessages()
  savingDef.value = true
  try {
    await $fetch(`/api/admin/networks/${id.value}/property-definitions/${d.key}`, {
      method: 'PATCH',
      body: {
        label: defEdit.label.trim() || d.key,
        description: defEdit.description.trim() || null,
        type: defEdit.type,
        required: defEdit.required,
      },
    })
    editingDefKey.value = null
    await loadDefinitions()
    if (defEdit.type !== d.type) await loadValues()
  } catch (err) {
    showError(err, 'Failed to save property')
  } finally {
    savingDef.value = false
  }
}

async function deleteDefinition(d: NetworkPropertyDefinition) {
  if (!confirm(`Delete property "${d.key}"? All values for this property across the roster will be deleted too.`)) {
    return
  }
  clearMessages()
  try {
    await $fetch(`/api/admin/networks/${id.value}/property-definitions/${d.key}`, {
      method: 'DELETE',
    })
    await Promise.all([loadDefinitions(), loadValues()])
  } catch (err) {
    showError(err, 'Failed to delete property')
  }
}

async function moveDefinition(d: NetworkPropertyDefinition, toIndex: number) {
  if (toIndex < 0 || toIndex >= definitions.value.length) return
  clearMessages()
  reorderingDef.value = true
  const reordered = [...definitions.value]
  const fromIndex = reordered.findIndex((x) => x.id === d.id)
  reordered.splice(fromIndex, 1)
  reordered.splice(toIndex, 0, d)
  try {
    for (let i = 0; i < reordered.length; i++) {
      const target = reordered[i]
      if (target.position !== i) {
        await $fetch(`/api/admin/networks/${id.value}/property-definitions/${target.key}`, {
          method: 'PATCH',
          body: { position: i },
        })
      }
    }
    await loadDefinitions()
  } catch (err) {
    showError(err, 'Failed to reorder property')
  } finally {
    reorderingDef.value = false
  }
}

// --- Custom Properties: per-podcast values ---

const expandedRows = ref<Set<number>>(new Set())

function toggleExpand(podcastId: number) {
  if (expandedRows.value.has(podcastId)) expandedRows.value.delete(podcastId)
  else expandedRows.value.add(podcastId)
  // trigger reactivity on Set mutations
  expandedRows.value = new Set(expandedRows.value)
}

function getValue(podcastId: number, key: string): string | number | boolean | null {
  return valuesByPodcast.value.get(podcastId)?.get(key) ?? null
}
function stringValue(podcastId: number, key: string): string {
  const v = getValue(podcastId, key)
  return v == null ? '' : String(v)
}
function boolValue(podcastId: number, key: string): boolean {
  return getValue(podcastId, key) === true
}
function valueIsSet(podcastId: number, key: string): boolean {
  return getValue(podcastId, key) !== null
}

// Per-cell save state for inline feedback. Keyed by `${podcastId}:${key}`.
const cellState = ref<Map<string, 'saving' | 'ok' | 'err'>>(new Map())
const cellError = ref<Map<string, string>>(new Map())
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
const DEBOUNCE_MS = 500

function cellKey(podcastId: number, key: string) {
  return `${podcastId}:${key}`
}
function saveState(podcastId: number, key: string) {
  return cellState.value.get(cellKey(podcastId, key))
}
function valueErr(podcastId: number, key: string) {
  return cellError.value.get(cellKey(podcastId, key)) || 'Save failed'
}

function setCellState(podcastId: number, key: string, state: 'saving' | 'ok' | 'err' | null, errMsg?: string) {
  const k = cellKey(podcastId, key)
  if (state === null) {
    cellState.value.delete(k)
    cellError.value.delete(k)
  } else {
    cellState.value.set(k, state)
    if (errMsg) cellError.value.set(k, errMsg)
    else cellError.value.delete(k)
  }
  cellState.value = new Map(cellState.value)
  cellError.value = new Map(cellError.value)
}

function onValueInput(podcastId: number, key: string, raw: string) {
  // Write the raw keystroke into the local bucket SYNCHRONOUSLY before any
  // reactive state change. setCellState('saving') below triggers a re-render
  // and Vue re-evaluates `:value` from this bucket; if the bucket still held
  // the pre-keystroke value, Vue would write it back to the DOM and erase
  // what the user just typed. Persisting happens later via the debounce.
  let bucket = valuesByPodcast.value.get(podcastId)
  if (!bucket) {
    bucket = new Map()
    valuesByPodcast.value.set(podcastId, bucket)
  }
  bucket.set(key, raw)

  const k = cellKey(podcastId, key)
  const existing = debounceTimers.get(k)
  if (existing) clearTimeout(existing)
  setCellState(podcastId, key, 'saving')
  const timer = setTimeout(() => persistValue(podcastId, key, raw), DEBOUNCE_MS)
  debounceTimers.set(k, timer)
}

function onValueImmediate(podcastId: number, key: string, raw: unknown) {
  setCellState(podcastId, key, 'saving')
  persistValue(podcastId, key, raw)
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

function hexOrDefault(raw: string): string {
  return HEX_RE.test(raw) ? raw : '#000000'
}

// Color text input: optimistically reflect every keystroke locally so the
// user can type freely, but only fire the server PUT when the value is a
// complete 6-digit hex (or empty, which means "clear"). Intermediate states
// like "#ab" stay local — the swatch falls back to #000000 and no error
// fires.
function onColorTextInput(podcastId: number, key: string, raw: string) {
  let bucket = valuesByPodcast.value.get(podcastId)
  if (!bucket) {
    bucket = new Map()
    valuesByPodcast.value.set(podcastId, bucket)
  }
  bucket.set(key, raw)

  const k = cellKey(podcastId, key)
  const existing = debounceTimers.get(k)
  if (existing) clearTimeout(existing)

  if (raw === '' || HEX_RE.test(raw)) {
    setCellState(podcastId, key, 'saving')
    const timer = setTimeout(() => persistValue(podcastId, key, raw), DEBOUNCE_MS)
    debounceTimers.set(k, timer)
  } else {
    // Mid-typing — drop any prior save indicator so the user doesn't see
    // stale "Saved" while they're entering a partial hex.
    setCellState(podcastId, key, null)
  }
}

async function persistValue(podcastId: number, key: string, raw: unknown) {
  if (raw === '' || raw === null || raw === undefined) {
    // empty string = treat as clear, so the consumer never sees ""
    await clearValue(podcastId, key)
    return
  }
  try {
    const res = await $fetch<{ key: string; value: string; type: string }>(
      `/api/admin/networks/${id.value}/podcasts/${podcastId}/properties/${key}`,
      { method: 'PUT', body: { value: raw } },
    )
    let bucket = valuesByPodcast.value.get(podcastId)
    if (!bucket) {
      bucket = new Map()
      valuesByPodcast.value.set(podcastId, bucket)
    }
    // Coerce locally to match what the read endpoint would return so the
    // UI shows the same canonical form (e.g. lowercased hex).
    bucket.set(key, coerceLocal(res.type as NetworkPropertyType, res.value))
    valuesByPodcast.value = new Map(valuesByPodcast.value)
    setCellState(podcastId, key, 'ok')
    setTimeout(() => setCellState(podcastId, key, null), 1500)
  } catch (err) {
    const msg = (err as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Save failed'
    setCellState(podcastId, key, 'err', msg)
  }
}

async function clearValue(podcastId: number, key: string) {
  try {
    await $fetch(
      `/api/admin/networks/${id.value}/podcasts/${podcastId}/properties/${key}`,
      { method: 'DELETE' },
    )
    valuesByPodcast.value.get(podcastId)?.delete(key)
    valuesByPodcast.value = new Map(valuesByPodcast.value)
    setCellState(podcastId, key, 'ok')
    setTimeout(() => setCellState(podcastId, key, null), 1500)
  } catch (err) {
    const msg = (err as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Clear failed'
    setCellState(podcastId, key, 'err', msg)
  }
}

function coerceLocal(type: NetworkPropertyType, raw: string): string | number | boolean {
  if (type === 'boolean') return raw === 'true'
  if (type === 'number') return Number(raw)
  return raw
}

async function doDelete() {
  deleting.value = true
  errorMsg.value = ''
  try {
    await $fetch(`/api/admin/networks/${id.value}`, { method: 'DELETE' })
    await navigateTo('/admin/networks')
  } catch (err) {
    showError(err, 'Failed to delete')
    deleting.value = false
    confirmDelete.value = false
  }
}

watch(() => network.value?.podcasts.length, () => { refreshPodcasts() })

useHead({ title: () => (network.value ? `${network.value.title} — Admin` : 'Network — Admin') })
</script>

<style scoped>
* { box-sizing: border-box; }
.admin-page { min-height: 100vh; background: #f7fafc; font-family: system-ui, sans-serif; }
.container { max-width: 900px; margin: 0 auto; padding: 2rem 1.25rem; }

.back-link {
  display: inline-block;
  color: #667eea;
  text-decoration: none;
  font-size: 0.85rem;
  margin-bottom: 0.5rem;
}
.back-link:hover { text-decoration: underline; }

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin: 0.5rem 0 0.25rem;
}
h1 { margin: 0; font-size: 1.5rem; color: #1a202c; }
.dim { color: #718096; font-size: 0.85rem; margin: 0 0 1.25rem; }
.mono { font-family: monospace; color: #4c51bf; }
code.mono { font-size: 0.85em; }

.card {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 1.25rem 1.5rem;
  margin-bottom: 1.25rem;
}
.card-heading {
  margin: 0 0 0.75rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: #4a5568;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.card-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 0.5rem;
}

.form-group { margin-bottom: 0.875rem; }
.form-group label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: #4a5568;
  margin-bottom: 0.375rem;
}
.form-group input,
.form-group textarea,
.form-group select {
  display: block;
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.9rem;
  font-family: inherit;
  background: white;
}
.hint { margin: 0.3rem 0 0.75rem; font-size: 0.78rem; color: #718096; line-height: 1.4; }

.btn-primary {
  padding: 0.5rem 1rem;
  background: #667eea; color: white;
  border: none; border-radius: 6px;
  font-size: 0.875rem; font-weight: 500; cursor: pointer;
}
.btn-primary:hover:not(:disabled) { background: #5a67d8; }
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-secondary {
  padding: 0.5rem 1rem;
  background: white; color: #4a5568;
  border: 1px solid #e2e8f0; border-radius: 6px;
  font-size: 0.875rem; cursor: pointer;
}
.btn-danger {
  padding: 0.5rem 1rem;
  background: #e53e3e; color: white;
  border: none; border-radius: 6px;
  font-size: 0.875rem; font-weight: 500; cursor: pointer;
}
.btn-danger:hover:not(:disabled) { background: #c53030; }
.btn-danger:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-remove {
  padding: 0.35rem 0.7rem;
  background: white;
  color: #c53030;
  border: 1px solid #fc8181;
  border-radius: 6px;
  font-size: 0.8rem;
  cursor: pointer;
}
.btn-remove:hover:not(:disabled) { background: #fff5f5; }
.btn-remove:disabled { opacity: 0.6; cursor: not-allowed; }

.btn-link {
  background: none;
  border: none;
  color: #4c51bf;
  cursor: pointer;
  font-size: 0.8rem;
  padding: 0.25rem 0.4rem;
  font-family: inherit;
}
.btn-link:hover { text-decoration: underline; }
.btn-link.danger { color: #c53030; }
.btn-link.cancel { color: #718096; }
.btn-link:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-expand {
  background: white;
  color: #4c51bf;
  border: 1px solid #c3dafe;
  border-radius: 6px;
  padding: 0.35rem 0.7rem;
  font-size: 0.78rem;
  cursor: pointer;
  margin-right: 0.4rem;
}
.btn-expand:hover { background: #ebf4ff; }

.btn-clear {
  background: white;
  color: #c53030;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  width: 24px;
  height: 24px;
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1;
  padding: 0;
  margin-left: 0.35rem;
}
.btn-clear:hover { background: #fff5f5; border-color: #fc8181; }

/* Definitions table */

.def-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 0.5rem;
}
.def-table th {
  text-align: left;
  font-size: 0.72rem;
  font-weight: 600;
  color: #718096;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.4rem 0.5rem;
  border-bottom: 1px solid #e2e8f0;
}
.def-table td {
  padding: 0.5rem;
  border-bottom: 1px solid #f0f4f8;
  font-size: 0.9rem;
}
.def-table tr:last-child td { border-bottom: none; }
.def-actions {
  text-align: right;
  white-space: nowrap;
}
.def-position {
  display: flex;
  gap: 0.2rem;
}
.inline-input {
  width: 100%;
  padding: 0.3rem 0.5rem;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  font-size: 0.85rem;
  font-family: inherit;
  background: white;
}
textarea.inline-input.desc-input {
  margin-top: 0.3rem;
  resize: vertical;
  min-height: 2.2rem;
}

.info-icon {
  display: inline-block;
  margin-left: 0.3rem;
  color: #718096;
  cursor: help;
  font-size: 0.85em;
  user-select: none;
}
.info-icon:hover { color: #4c51bf; }

.add-desc {
  display: block;
  width: 100%;
  margin-top: 0.5rem;
  padding: 0.45rem 0.7rem;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.85rem;
  font-family: inherit;
  background: white;
  resize: vertical;
  min-height: 2.4rem;
}

.type-tag {
  display: inline-block;
  font-size: 0.7rem;
  padding: 0.05rem 0.5rem;
  background: #ebf4ff;
  color: #4c51bf;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 600;
}

.add-def-grid {
  display: grid;
  grid-template-columns: 1.2fr 1.5fr 1fr auto auto;
  gap: 0.5rem;
  align-items: center;
}
.add-def-grid input,
.add-def-grid select {
  padding: 0.45rem 0.7rem;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.9rem;
  font-family: inherit;
  background: white;
}
.required-toggle {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.8rem;
  color: #4a5568;
  white-space: nowrap;
}

/* Roster */

.roster-list {
  list-style: none;
  margin: 0 0 1rem;
  padding: 0;
}
.roster-row-wrap {
  border-bottom: 1px solid #f0f4f8;
}
.roster-row-wrap:last-child { border-bottom: none; }
.roster-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 0;
}
.roster-position {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.pos-btn {
  width: 22px;
  height: 18px;
  border: 1px solid #e2e8f0;
  background: white;
  color: #4a5568;
  cursor: pointer;
  font-size: 0.6rem;
  border-radius: 3px;
  padding: 0;
  line-height: 1;
}
.pos-btn:hover:not(:disabled) { background: #f7fafc; border-color: #667eea; color: #667eea; }
.pos-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.roster-art {
  width: 40px;
  height: 40px;
  border-radius: 5px;
  object-fit: cover;
  background: #edf2f7;
}
.roster-art.placeholder { background: #edf2f7; }
.roster-info { flex: 1; min-width: 0; }
.roster-title { font-weight: 500; color: #1a202c; font-size: 0.95rem; }
.roster-slug { font-size: 0.78rem; }
.status-tag {
  display: inline-block;
  margin-left: 0.4rem;
  font-size: 0.7rem;
  padding: 0.05rem 0.45rem;
  background: #fffaf0;
  color: #b7791f;
  border: 1px solid #f6ad55;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 600;
}

/* Per-podcast value grid */

.value-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 0.625rem 1rem;
  padding: 0.5rem 0 0.875rem 4.5rem;
  background: #fafbfc;
  border-radius: 0 0 6px 6px;
}
.value-cell {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}
.value-label {
  font-size: 0.75rem;
  color: #4a5568;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.required-badge {
  font-size: 0.62rem;
  padding: 0 0.35rem;
  background: #fef5e7;
  color: #b7791f;
  border-radius: 999px;
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.value-controls {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}
.value-controls input[type="text"],
.value-controls input[type="number"],
.value-controls input[type="url"] {
  flex: 1;
  min-width: 0;
  padding: 0.35rem 0.55rem;
  border: 1px solid #e2e8f0;
  border-radius: 5px;
  font-size: 0.85rem;
  font-family: inherit;
  background: white;
}
.value-controls input[type="color"] {
  width: 44px;
  height: 30px;
  padding: 0;
  border: 1px solid #e2e8f0;
  border-radius: 5px;
  background: white;
}
.value-controls .color-swatch {
  flex: 0 0 auto;
}
.value-controls .color-hex {
  flex: 1;
  min-width: 0;
  padding: 0.35rem 0.55rem;
  border: 1px solid #e2e8f0;
  border-radius: 5px;
  font-size: 0.85rem;
  font-family: monospace;
  background: white;
  text-transform: lowercase;
}
.bool-toggle {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  color: #2d3748;
}
.value-state {
  font-size: 0.7rem;
  margin-top: 0.1rem;
  font-weight: 500;
}
.value-state.saving { color: #718096; }
.value-state.ok { color: #2f855a; }
.value-state.err { color: #c53030; }

.empty { text-align: center; color: #718096; padding: 1rem; font-size: 0.9rem; }

.add-row {
  margin-top: 0.75rem;
  padding-top: 0.875rem;
  border-top: 1px solid #f0f4f8;
}
.add-label {
  display: block;
  font-size: 0.8rem;
  color: #4a5568;
  font-weight: 500;
  margin-bottom: 0.5rem;
}
.add-controls {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
.add-controls select { flex: 1; }

.loading {
  text-align: center;
  color: #718096;
  padding: 2rem;
}

.error-msg {
  background: #fff5f5; border: 1px solid #fc8181;
  color: #c53030; padding: 0.75rem 1rem;
  border-radius: 8px; margin: 0.5rem 0 1rem; font-size: 0.9rem;
}
.success-msg {
  background: #f0fff4; border: 1px solid #9ae6b4;
  color: #2f855a; padding: 0.75rem 1rem;
  border-radius: 8px; margin: 0.5rem 0 1rem; font-size: 0.9rem;
}

.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
}
.modal {
  background: white; border-radius: 10px;
  padding: 1.75rem; max-width: 460px; width: 90%;
}
.modal h3 { margin: 0 0 1rem; font-size: 1.05rem; }
.modal-actions { display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem; }

@media (max-width: 720px) {
  .container { padding: 1rem 0.75rem; }
  .page-header {
    flex-direction: column;
    align-items: stretch;
  }
  .add-controls {
    flex-direction: column;
    align-items: stretch;
  }
  .add-controls .btn-primary { min-height: 44px; }
  .add-def-grid {
    grid-template-columns: 1fr;
  }
  .value-grid {
    padding-left: 0.5rem;
  }
}
</style>
