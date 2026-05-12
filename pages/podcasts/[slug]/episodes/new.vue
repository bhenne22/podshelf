<template>
  <div class="admin-page">
    <AdminNav :podcast-slug="podcastSlug" />
    <div class="container">
      <div class="page-header">
        <h1>New Episode</h1>
        <NuxtLink :to="`/podcasts/${podcastSlug}/episodes`" class="btn-back">← Back to Episodes</NuxtLink>
      </div>

      <div v-if="successMsg" class="success-msg">{{ successMsg }}</div>
      <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

      <form @submit.prevent="onSubmit" class="episode-form">
        <div class="form-actions form-actions-top">
          <span v-if="saving" class="save-status saving">Saving…</span>
          <span v-else-if="errorMsg" class="save-status err">✗ {{ errorMsg }}</span>
          <NuxtLink :to="`/podcasts/${podcastSlug}/episodes`" class="btn-secondary">Cancel</NuxtLink>
          <button
            v-for="a in availableActions"
            :key="`top-${a.key}`"
            type="button"
            :class="a.style"
            :disabled="saving || a.disabled"
            @click="saveEpisode(a.key)"
          >
            {{ a.label }}
          </button>
        </div>

        <div class="form-section publishing-section">
          <h2>Publishing</h2>
          <p class="hint section-hint">
            Set a publish date to schedule for later, leave it blank to publish immediately, or save as a draft.
          </p>

          <div class="form-row">
            <div class="form-group flex-2">
              <label for="published_at_top">Publish Date</label>
              <input id="published_at_top" v-model="form.published_at" type="datetime-local" />
              <p class="hint">Times are in the podcast's timezone: <strong>{{ podcastTz }}</strong> ({{ tzAbbr }}).</p>
            </div>
          </div>

          <NetworkConflictHint :podcast-slug="podcastSlug" :publish-at="publishAtIso" />
        </div>

        <div class="form-section">
          <h2>Basic Info</h2>
          <div class="form-row">
            <div class="form-group flex-2">
              <label for="title">Title <span class="required">*</span></label>
              <input
                id="title"
                v-model="form.title"
                type="text"
                placeholder="Episode title"
                required
                @input="autoSlug"
              />
            </div>
            <div v-if="episodeNumbersEnabled" class="form-group">
              <label for="episode_number">Episode #</label>
              <input id="episode_number" v-model.number="form.episode_number" type="number" min="1" placeholder="e.g. 42" />
            </div>
            <div v-if="seasonsEnabled" class="form-group">
              <label for="season_number">Season #</label>
              <input id="season_number" v-model.number="form.season_number" type="number" min="1" placeholder="e.g. 2" />
            </div>
            <div class="form-group">
              <label for="episode_type">Type</label>
              <select id="episode_type" v-model="form.episode_type">
                <option value="full">Full</option>
                <option value="trailer">Trailer</option>
                <option value="bonus">Bonus</option>
              </select>
            </div>
          </div>

          <div class="form-group">
            <label for="slug">
              Slug
              <span class="hint">Auto-generated from title. Used in URL: /episodes/<em>slug</em></span>
            </label>
            <input id="slug" v-model="form.slug" type="text" placeholder="my-episode-title" />
          </div>

          <div class="form-group">
            <label for="description">Show Notes / Description</label>
            <RichTextEditor
              v-model="form.description"
              :rows="10"
              placeholder="Describe your episode, add links, timestamps, etc."
            />
          </div>
        </div>

        <div class="form-section">
          <h2>Audio</h2>
          <div class="form-group">
            <label for="audio_file">Upload Audio File</label>
            <input
              id="audio_file"
              type="file"
              accept="audio/*"
              @change="handleFileChange"
              class="file-input"
            />
            <p class="hint">MP3 or M4A recommended. File will be uploaded to your configured storage.</p>
          </div>

          <div v-if="uploading" class="upload-progress">
            <div class="progress-text">Uploading audio… {{ uploadProgress }}%</div>
            <div class="progress-bar-track">
              <div class="progress-bar-fill" :style="{ width: uploadProgress + '%' }"></div>
            </div>
          </div>

          <div class="form-group">
            <label for="audio_url">Audio URL</label>
            <div class="input-with-action">
              <input
                id="audio_url"
                v-model="form.audio_url"
                type="url"
                placeholder="https://example.com/audio/episode.mp3"
              />
              <button
                type="button"
                class="btn-probe"
                :disabled="!form.audio_url || probing"
                @click="probeAudio"
              >
                {{ probing ? 'Checking…' : 'Check File' }}
              </button>
            </div>
            <p class="hint">Auto-filled after upload, or enter manually. Use "Check File" to detect size &amp; duration.</p>
          </div>

          <div v-if="probeError" class="probe-error">{{ probeError }}</div>

          <div class="form-row">
            <div class="form-group">
              <label for="audio_size">
                File Size (bytes)
                <button type="button" class="lock-toggle" @click="fieldsUnlocked = !fieldsUnlocked" :title="fieldsUnlocked ? 'Lock fields' : 'Unlock for manual editing'">
                  {{ fieldsUnlocked ? 'Lock' : 'Unlock' }}
                </button>
              </label>
              <input
                id="audio_size"
                v-model.number="form.audio_size_bytes"
                type="number"
                min="0"
                placeholder="Auto-detected"
                :readonly="!fieldsUnlocked"
                :class="{ 'field-locked': !fieldsUnlocked }"
              />
            </div>
            <div class="form-group">
              <label for="audio_duration">Duration (seconds)</label>
              <input
                id="audio_duration"
                v-model.number="form.audio_duration_seconds"
                type="number"
                min="0"
                placeholder="Auto-detected"
                :readonly="!fieldsUnlocked"
                :class="{ 'field-locked': !fieldsUnlocked }"
              />
            </div>
            <div v-if="form.audio_duration_seconds" class="form-group">
              <label>Formatted</label>
              <div class="duration-display">{{ formatDuration(form.audio_duration_seconds) }}</div>
            </div>
          </div>
        </div>

        <div class="form-section">
          <h2>Episode Artwork</h2>
          <p class="hint">Optional. If unset, the podcast's main artwork is used in the RSS feed.</p>

          <div v-if="form.image_url" class="artwork-preview">
            <img :src="form.image_url" :alt="form.title || 'Episode artwork'" class="artwork-thumb" />
            <div class="artwork-meta">
              <strong>Current:</strong>
              <a :href="form.image_url" target="_blank" rel="noopener">{{ form.image_filename || form.image_url }}</a>
            </div>
            <button type="button" class="btn-secondary btn-clear-artwork" @click="form.image_url = ''; form.image_filename = ''">Clear</button>
          </div>

          <div class="form-group">
            <label for="image_file">Upload Artwork</label>
            <div class="upload-and-pick">
              <input id="image_file" type="file" accept="image/jpeg,image/png,image/webp" @change="handleArtworkChange" class="file-input" />
              <button type="button" class="btn-secondary" @click="pickerOpen = true">Pick from gallery</button>
            </div>
            <p class="hint">JPEG, PNG, or WebP. Square image, ideally 1400×1400+.</p>
          </div>

          <div v-if="artworkUploading" class="upload-progress">Uploading artwork… {{ uploadProgress }}%</div>
          <div v-if="artworkError" class="probe-error">{{ artworkError }}</div>

          <div class="form-group">
            <label for="image_url">Artwork URL</label>
            <input id="image_url" v-model="form.image_url" type="url" placeholder="https://example.com/artwork/episode-42.jpg" />
            <p class="hint">Auto-filled after upload or pick, or paste a URL directly.</p>
          </div>
        </div>

        <ArtworkPicker
          :open="pickerOpen"
          :podcast-slug="podcastSlug"
          @close="pickerOpen = false"
          @select="onArtworkPicked"
        />

        <div class="form-section">
          <h2>Transcript</h2>
          <p class="hint">
            Upload a transcript file or paste a URL — emits <code>podcast:transcript</code>.
            Leave blank to skip.
          </p>

          <div class="form-group">
            <label for="transcript_file">Upload transcript</label>
            <input
              id="transcript_file"
              type="file"
              accept=".html,.htm,.txt,.srt,.vtt,.json,text/html,text/plain,text/vtt,application/srt,application/x-subrip,application/json"
              @change="handleTranscriptChange"
              class="file-input"
            />
            <p class="hint">HTML, plain text, SRT, WebVTT, or JSON. Goes into your audio directory.</p>
          </div>

          <div v-if="transcriptUploading" class="upload-progress">Uploading transcript… {{ uploadProgress }}%</div>
          <div v-if="transcriptError" class="probe-error">{{ transcriptError }}</div>

          <div class="form-row">
            <div class="form-group flex-2">
              <label for="transcript_path">Transcript URL</label>
              <input id="transcript_path" v-model="form.transcript_path" type="url"
                placeholder="https://example.com/episode-42.html" />
            </div>
            <div class="form-group">
              <label for="transcript_type">Type</label>
              <select id="transcript_type" v-model="form.transcript_type">
                <option value="">Auto-detect</option>
                <option value="text/html">HTML</option>
                <option value="text/plain">Plain text</option>
                <option value="application/srt">SRT</option>
                <option value="text/vtt">WebVTT</option>
                <option value="application/json">JSON</option>
              </select>
            </div>
          </div>
          <p class="hint">Chapters and people can be configured after the episode is created.</p>
        </div>

        <div class="form-section">
          <h2>Per-episode RSS overrides</h2>
          <p class="hint">All optional. Override channel-level defaults for this single episode.</p>
          <div class="form-row">
            <div class="form-group flex-2">
              <label for="itunes_title">Clean title</label>
              <input id="itunes_title" v-model="form.itunes_title" type="text"
                placeholder='Without "S2E22:" prefix' />
            </div>
            <div class="form-group">
              <label for="itunes_explicit">Explicit override</label>
              <select id="itunes_explicit" v-model="form.itunes_explicit">
                <option value="">Inherit</option>
                <option value="false">No (Clean)</option>
                <option value="true">Yes (Explicit)</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group flex-2">
              <label for="itunes_author">Author override</label>
              <input id="itunes_author" v-model="form.itunes_author" type="text"
                placeholder='e.g. "Jane Doe with John Roe"' />
            </div>
          </div>
          <div class="form-row">
            <div v-if="seasonsEnabled" class="form-group">
              <label for="season_name">Season name</label>
              <input id="season_name" v-model="form.season_name" type="text" placeholder='e.g. "Series 1"' />
            </div>
            <div class="form-group">
              <label for="episode_display">Episode display</label>
              <input id="episode_display" v-model="form.episode_display" type="text" placeholder='e.g. "S2E22"' />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="ep_license_identifier">License override</label>
              <input id="ep_license_identifier" v-model="form.license_identifier" type="text" placeholder="CC-BY-4.0" />
            </div>
            <div class="form-group flex-2">
              <label for="ep_license_url">License URL</label>
              <input id="ep_license_url" v-model="form.license_url" type="url"
                placeholder="https://creativecommons.org/licenses/by/4.0/" />
            </div>
          </div>
        </div>

        <div class="form-section rss-preview">
          <h2>RSS Preview</h2>
          <div class="preview-grid">
            <div class="preview-item">
              <span class="preview-label">itunes:title</span>
              <span class="preview-value">{{ form.title || '—' }}</span>
            </div>
            <div v-if="episodeNumbersEnabled" class="preview-item">
              <span class="preview-label">itunes:episode</span>
              <span class="preview-value">{{ form.episode_number || '—' }}</span>
            </div>
            <div v-if="seasonsEnabled" class="preview-item">
              <span class="preview-label">itunes:season</span>
              <span class="preview-value">{{ form.season_number || '—' }}</span>
            </div>
            <div class="preview-item">
              <span class="preview-label">enclosure url</span>
              <span class="preview-value">{{ form.audio_url || '—' }}</span>
            </div>
            <div class="preview-item">
              <span class="preview-label">pubDate</span>
              <span class="preview-value">{{ pubDatePreview }}</span>
            </div>
            <div class="preview-item">
              <span class="preview-label">guid (url)</span>
              <span class="preview-value">/episodes/{{ form.slug || '—' }}</span>
            </div>
          </div>
        </div>

        <div class="form-actions">
          <span v-if="saving" class="save-status saving">Saving…</span>
          <span v-else-if="errorMsg" class="save-status err">✗ {{ errorMsg }}</span>
          <NuxtLink :to="`/podcasts/${podcastSlug}/episodes`" class="btn-secondary">Cancel</NuxtLink>
          <button
            v-for="a in availableActions"
            :key="`bot-${a.key}`"
            type="button"
            :class="a.style"
            :disabled="saving || a.disabled"
            @click="saveEpisode(a.key)"
          >
            {{ a.label }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { utcIsoToLocalInput, localInputToUtcIso, tzAbbreviation } from '~/utils/datetime-local'

definePageMeta({ middleware: 'auth' })

const route = useRoute()
const router = useRouter()
const podcastSlug = route.params.slug as string
const { createEpisode } = useEpisodes(podcastSlug)

interface PodcastFlags {
  seasons_enabled: number | null
  episode_numbers_enabled: number | null
  timezone: string | null
}
const { data: podcastSettings } = await useFetch<PodcastFlags>(`/api/podcasts/${podcastSlug}`)
const seasonsEnabled = computed(() => {
  const v = podcastSettings.value?.seasons_enabled
  return v == null ? true : !!v
})
const episodeNumbersEnabled = computed(() => {
  const v = podcastSettings.value?.episode_numbers_enabled
  return v == null ? true : !!v
})
// Wall-clock conversions for the Publish Date input run against the
// podcast's TZ so a co-host editing from a different country still sees
// (and writes) the same intended moment. Fall back to UTC until settings
// load — the dropdown won't fire before that anyway.
const podcastTz = computed(() => podcastSettings.value?.timezone || 'UTC')
const tzAbbr = computed(() => tzAbbreviation(podcastTz.value))
const pubDatePreview = computed(() => {
  if (!form.published_at) return '—'
  const iso = localInputToUtcIso(form.published_at, podcastTz.value)
  return iso ? new Date(iso).toUTCString() : '—'
})
// UTC ISO version of the publish-date input, in the shape NetworkConflictHint
// expects. Null until both the form value and the podcast timezone are ready.
const publishAtIso = computed<string | null>(() => {
  if (!form.published_at) return null
  return localInputToUtcIso(form.published_at, podcastTz.value) || null
})

const formDirty = ref(false)
const formSaved = ref(false)

const form = reactive({
  title: '',
  slug: '',
  episode_number: null as number | null,
  season_number: null as number | null,
  description: '',
  audio_url: '',
  audio_filename: '',
  audio_size_bytes: null as number | null,
  audio_duration_seconds: null as number | null,
  image_url: '',
  image_filename: '',
  published_at: '',
  status: 'draft',
  transcript_path: '',
  transcript_type: '',
  episode_type: 'full',
  itunes_title: '',
  itunes_author: '',
  itunes_explicit: '',
  season_name: '',
  episode_display: '',
  license_identifier: '',
  license_url: '',
})

const saving = ref(false)
const probing = ref(false)
const probeError = ref('')
const fieldsUnlocked = ref(false)
const { uploading, uploadProgress, uploadFile } = useUpload(podcastSlug)
const artworkUploading = ref(false)
const artworkError = ref('')
const transcriptUploading = ref(false)
const transcriptError = ref('')
const errorMsg = ref('')
const successMsg = ref('')
let slugManuallyEdited = false

const VALID_TRANSCRIPT_TYPES = new Set([
  'text/html', 'text/plain', 'text/vtt', 'application/srt', 'application/json',
])

async function handleTranscriptChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  transcriptError.value = ''
  transcriptUploading.value = true
  try {
    const result = await uploadFile(file, 'transcript')
    form.transcript_path = result.url
    if (result.content_type && VALID_TRANSCRIPT_TYPES.has(result.content_type)) {
      form.transcript_type = result.content_type
    }
  } catch (err: unknown) {
    transcriptError.value = err instanceof Error ? err.message : 'Upload failed'
  } finally {
    transcriptUploading.value = false
    input.value = ''
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function autoSlug() {
  if (!slugManuallyEdited) {
    form.slug = slugify(form.title)
  }
}

// Watch slug input for manual edits
watch(() => form.slug, (newVal, oldVal) => {
  if (newVal !== slugify(form.title)) {
    slugManuallyEdited = true
  }
})

// Dirty tracking starts AFTER template pre-fill so a user who hasn't typed
// anything doesn't get the leave-page prompt just because the template
// populated the form for them.
let dirtyWatcherStop: (() => void) | null = null
function startDirtyWatcher() {
  if (dirtyWatcherStop) return
  dirtyWatcherStop = watch(form, () => { formDirty.value = true }, { deep: true })
}

onBeforeRouteLeave(() => {
  if (formDirty.value && !formSaved.value) {
    return window.confirm('You have unsaved changes. Leave anyway?')
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  if (dirtyWatcherStop) dirtyWatcherStop()
})

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (formDirty.value && !formSaved.value) {
    e.preventDefault()
  }
}

interface EpisodeTemplate {
  title: string
  description: string
  season_number: number | null
  episode_number: number
}

onMounted(async () => {
  window.addEventListener('beforeunload', onBeforeUnload)

  try {
    const tpl = await $fetch<EpisodeTemplate>(
      `/api/podcasts/${podcastSlug}/episodes/template`,
    )
    if (tpl.title) form.title = tpl.title
    if (tpl.description) form.description = tpl.description
    if (tpl.season_number !== null) form.season_number = tpl.season_number
    form.episode_number = tpl.episode_number
    if (form.title) form.slug = slugify(form.title)
  } catch {
    // Template fetch failure is non-fatal; leave the form empty.
  }

  await nextTick()
  startDirtyWatcher()
})

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  errorMsg.value = ''

  try {
    const result = await uploadFile(file)
    form.audio_url = result.url
    form.audio_filename = result.filename
    form.audio_size_bytes = result.size
  } catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : 'Upload failed'
  }
}

async function handleArtworkChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  artworkError.value = ''
  artworkUploading.value = true
  try {
    const result = await uploadFile(file, 'artwork')
    form.image_url = result.url
    form.image_filename = result.filename
  } catch (err: unknown) {
    artworkError.value = err instanceof Error ? err.message : 'Artwork upload failed'
  } finally {
    artworkUploading.value = false
  }
}

const pickerOpen = ref(false)
function onArtworkPicked(payload: { url: string; name: string }) {
  form.image_url = payload.url
  form.image_filename = payload.name
}

async function probeAudio() {
  if (!form.audio_url) return
  probing.value = true
  probeError.value = ''

  try {
    // Get file size via server-side HEAD request
    const probe = await $fetch<{ size: number | null; contentType: string | null }>(
      '/api/audio-probe',
      { query: { url: form.audio_url } }
    )
    if (probe.size) {
      form.audio_size_bytes = probe.size
    }

    // Get duration via browser Audio element
    const audio = new Audio()
    audio.preload = 'metadata'
    const durationPromise = new Promise<number>((resolve, reject) => {
      audio.onloadedmetadata = () => resolve(audio.duration)
      audio.onerror = () => reject(new Error('Could not load audio metadata'))
      setTimeout(() => reject(new Error('Timed out loading audio metadata')), 15000)
    })
    audio.src = form.audio_url
    const duration = await durationPromise
    if (duration && isFinite(duration)) {
      form.audio_duration_seconds = Math.round(duration)
    }
  } catch (err: unknown) {
    probeError.value = err instanceof Error ? err.message : 'Failed to probe audio'
  } finally {
    probing.value = false
  }
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) {
    return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
  }
  return `${m}m ${String(s).padStart(2, '0')}s`
}

type SaveAction = 'save_draft' | 'publish_now' | 'schedule'

const publishedAtIsFuture = computed(() => {
  if (!form.published_at) return false
  const iso = localInputToUtcIso(form.published_at, podcastTz.value)
  if (!iso) return false
  const t = new Date(iso).getTime()
  return Number.isFinite(t) && t > Date.now()
})

interface ActionDef {
  key: SaveAction
  label: string
  style: string
  disabled?: boolean
}
const availableActions = computed<ActionDef[]>(() => {
  const list: ActionDef[] = [
    { key: 'save_draft', label: 'Save Draft', style: 'btn-primary' },
    { key: 'publish_now', label: 'Save & Publish', style: 'btn-publish' },
  ]
  if (publishedAtIsFuture.value) {
    list.push({ key: 'schedule', label: 'Save & Schedule', style: 'btn-schedule' })
  }
  return list
})

async function saveEpisode(action: SaveAction) {
  saving.value = true
  errorMsg.value = ''

  let status: string
  let publishedAtIso: string | null

  if (action === 'publish_now') {
    status = 'published'
    publishedAtIso = new Date().toISOString()
  } else if (action === 'schedule') {
    publishedAtIso = localInputToUtcIso(form.published_at, podcastTz.value)
    if (!publishedAtIso) {
      errorMsg.value = 'Pick a future publish date to schedule.'
      saving.value = false
      return
    }
    status = 'scheduled'
  } else {
    status = 'draft'
    publishedAtIso = form.published_at
      ? localInputToUtcIso(form.published_at, podcastTz.value)
      : null
  }

  form.status = status

  try {
    const episode = await createEpisode({
      ...form,
      status,
      episode_number: form.episode_number || null,
      season_number: form.season_number || null,
      audio_size_bytes: form.audio_size_bytes || null,
      audio_duration_seconds: form.audio_duration_seconds || null,
      published_at: publishedAtIso,
    })
    formSaved.value = true
    await router.push(`/podcasts/${podcastSlug}/episodes/${episode.id}`)
  } catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : 'Failed to save episode'
  } finally {
    saving.value = false
  }
}

// Submit via Enter defaults to Save Draft — the lowest-stakes verb.
function onSubmit() {
  saveEpisode('save_draft')
}

useHead({ title: 'New Episode — Podshelf Admin' })
</script>

<style scoped>
* { box-sizing: border-box; }

.admin-page {
  min-height: 100vh;
  background: #f7fafc;
  font-family: system-ui, sans-serif;
}

.container {
  max-width: 800px;
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

.btn-back {
  font-size: 0.875rem;
  color: #667eea;
  text-decoration: none;
}

.btn-back:hover { text-decoration: underline; }

.episode-form {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.form-section {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 1.5rem;
}

.form-section h2 {
  margin: 0 0 1.25rem;
  font-size: 0.95rem;
  font-weight: 600;
  color: #4a5568;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.form-group {
  margin-bottom: 1rem;
}

.form-group:last-child { margin-bottom: 0; }

.form-row {
  display: flex;
  gap: 1rem;
}

.form-row .form-group { flex: 1; }
.form-row .form-group.flex-2 { flex: 2; }

label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: #4a5568;
  margin-bottom: 0.375rem;
}

.required { color: #e53e3e; }

input[type="text"],
input[type="url"],
input[type="number"],
input[type="datetime-local"],
select,
textarea {
  display: block;
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.9rem;
  font-family: system-ui, sans-serif;
  color: #2d3748;
  background: white;
  transition: border-color 0.15s;
  outline: none;
}

input:focus, select:focus, textarea:focus {
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
}

textarea { resize: vertical; line-height: 1.6; }

.file-input {
  padding: 0.375rem;
  background: #f7fafc;
}

.hint {
  font-size: 0.78rem;
  color: #718096;
  margin-top: 0.375rem;
}

.upload-progress {
  padding: 0.75rem 1rem;
  background: #ebf8ff;
  color: #2b6cb0;
  border-radius: 6px;
  font-size: 0.875rem;
  margin-bottom: 1rem;
}

.progress-text { margin-bottom: 0.5rem; }

.progress-bar-track {
  height: 6px;
  background: rgba(43, 108, 176, 0.15);
  border-radius: 3px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: #3182ce;
  border-radius: 3px;
  transition: width 0.15s linear;
}

.input-with-action {
  display: flex;
  gap: 0.5rem;
}

.input-with-action input { flex: 1; }

.btn-probe {
  padding: 0.5rem 0.875rem;
  background: #edf2f7;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 500;
  color: #4a5568;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}

.btn-probe:hover:not(:disabled) {
  background: #e2e8f0;
  border-color: #cbd5e0;
}

.btn-probe:disabled { opacity: 0.5; cursor: not-allowed; }

.probe-error {
  padding: 0.5rem 0.75rem;
  background: #fff5f5;
  color: #c53030;
  border-radius: 6px;
  font-size: 0.8rem;
  margin-bottom: 0.5rem;
}

.lock-toggle {
  background: none;
  border: none;
  font-size: 0.72rem;
  color: #667eea;
  cursor: pointer;
  padding: 0;
  margin-left: 0.375rem;
  font-weight: 400;
}

.lock-toggle:hover { text-decoration: underline; }

.field-locked {
  background: #f7fafc !important;
  color: #718096 !important;
  cursor: default;
}

.duration-display {
  padding: 0.5rem 0.75rem;
  background: #f7fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.9rem;
  color: #4a5568;
  font-variant-numeric: tabular-nums;
}

.artwork-preview {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 0.75rem;
  background: #f7fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  margin-bottom: 1rem;
}
.artwork-thumb {
  width: 72px;
  height: 72px;
  object-fit: cover;
  border-radius: 6px;
  background: #edf2f7;
  flex-shrink: 0;
}
.artwork-meta {
  flex: 1;
  font-size: 0.85rem;
  color: #4a5568;
  word-break: break-all;
}
.artwork-meta a { color: #667eea; }
.btn-clear-artwork {
  flex-shrink: 0;
  padding: 0.4rem 0.75rem;
  font-size: 0.8rem;
}
.upload-and-pick {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.upload-and-pick .file-input { flex: 1; min-width: 200px; }
.upload-and-pick .btn-secondary {
  padding: 0.45rem 0.875rem;
  background: #ebf4ff;
  border: 1px solid #c3dafe;
  color: #4c51bf;
  border-radius: 6px;
  font-size: 0.825rem;
  cursor: pointer;
  white-space: nowrap;
}
.upload-and-pick .btn-secondary:hover { background: #c3dafe; }

.rss-preview {
  background: #f8fafc;
}

.preview-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.625rem;
}

.preview-item {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.preview-label {
  font-size: 0.72rem;
  font-family: monospace;
  color: #718096;
  text-transform: lowercase;
}

.preview-value {
  font-size: 0.85rem;
  color: #2d3748;
  word-break: break-all;
}

.form-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  justify-content: flex-end;
  padding-bottom: 2rem;
}

.save-status {
  font-size: 0.875rem;
  font-weight: 500;
  margin-right: auto;
  padding-left: 0.25rem;
}
.save-status.saving { color: #718096; }
.save-status.ok { color: #2f855a; }
.save-status.err { color: #c53030; max-width: 380px; }

.btn-primary {
  padding: 0.6rem 1.25rem;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  text-decoration: none;
  transition: background 0.15s;
}

.btn-primary:hover:not(:disabled) { background: #5a67d8; }

.btn-publish {
  padding: 0.6rem 1.25rem;
  background: #38a169;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-publish:hover:not(:disabled) { background: #2f855a; }

.btn-schedule {
  padding: 0.6rem 1.25rem;
  background: #3182ce;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-schedule:hover:not(:disabled) { background: #2b6cb0; }

/* Top variant: action bar above the form, mirrors the bottom one. The
 * form's flex `gap` already separates it from the next section, so no
 * trailing padding. */
.form-actions-top { padding-bottom: 0; }

.publishing-section .section-hint {
  margin: 0 0 1rem;
}

.btn-secondary {
  padding: 0.6rem 1.25rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.9rem;
  cursor: pointer;
  text-decoration: none;
  color: #4a5568;
  transition: all 0.15s;
}

.btn-secondary:hover { background: #f7fafc; }

button:disabled { opacity: 0.6; cursor: not-allowed; }

.success-msg {
  background: #f0fff4;
  border: 1px solid #9ae6b4;
  color: #276749;
  padding: 0.875rem 1rem;
  border-radius: 8px;
  margin-bottom: 1rem;
}

.error-msg {
  background: #fff5f5;
  border: 1px solid #fc8181;
  color: #c53030;
  padding: 0.875rem 1rem;
  border-radius: 8px;
  margin-bottom: 1rem;
}

@media (max-width: 720px) {
  .container { padding: 1rem 0.75rem; }
  .form-section { padding: 1rem; }
  /* 16px input font prevents iOS Safari from zooming on focus. */
  input[type="text"],
  input[type="url"],
  input[type="number"],
  input[type="datetime-local"],
  select,
  textarea {
    font-size: 16px;
    padding: 0.625rem 0.75rem;
    min-height: 44px;
  }
  textarea { min-height: auto; }
  .form-row { flex-direction: column; gap: 0; }
  .preview-grid { grid-template-columns: 1fr; }
  .input-with-action { flex-wrap: wrap; }
  .input-with-action input { flex: 1 1 100%; min-width: 0; }
  .artwork-preview { flex-wrap: wrap; }
  .artwork-meta { flex-basis: 100%; order: 3; }
  .upload-and-pick { flex-direction: column; align-items: stretch; }
  .upload-and-pick .file-input { width: 100%; min-width: 0; }
  .upload-and-pick .btn-secondary { text-align: center; }
  .form-actions {
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .form-actions .btn-primary,
  .form-actions .btn-publish,
  .form-actions .btn-schedule,
  .form-actions .btn-secondary { flex: 1 1 auto; text-align: center; }
  .form-actions .save-status {
    flex-basis: 100%;
    margin-right: 0;
    text-align: center;
  }
}
</style>
