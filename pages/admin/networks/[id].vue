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
            <li v-for="(p, i) in network.podcasts" :key="p.id" class="roster-row">
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
                type="button"
                class="btn-remove"
                :disabled="removing === p.id"
                @click="removePodcast(p)"
              >
                {{ removing === p.id ? 'Removing…' : 'Remove' }}
              </button>
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
definePageMeta({ middleware: 'admin-only' })

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

const { data: network, pending, refresh } = await useFetch<NetworkDetail>(
  () => `/api/admin/networks/${id.value}`,
)
const { data: allPodcasts, refresh: refreshPodcasts } = await useFetch<PodcastBrief[]>('/api/podcasts')

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
  // Recompute every position so gaps don't matter — keeps the DB in a clean state.
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

// Refresh the all-podcasts list when the roster changes so the add-dropdown stays accurate.
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
.hint { margin: 0.3rem 0 0; font-size: 0.78rem; color: #718096; }

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

.roster-list {
  list-style: none;
  margin: 0 0 1rem;
  padding: 0;
}
.roster-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 0;
  border-bottom: 1px solid #f0f4f8;
}
.roster-row:last-child { border-bottom: none; }
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
}
</style>
