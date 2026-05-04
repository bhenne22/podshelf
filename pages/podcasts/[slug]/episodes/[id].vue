<template>
  <div class="admin-page">
    <AdminNav :podcast-slug="podcastSlug" />
    <div class="container">
      <div class="page-header">
        <h1>Edit Episode</h1>
        <div class="header-actions">
          <button type="button" class="btn-back" :disabled="duplicating" @click="duplicateEpisode">
            {{ duplicating ? 'Duplicating…' : 'Duplicate' }}
          </button>
          <NuxtLink :to="`/podcasts/${podcastSlug}/episodes`" class="btn-back">← Episodes</NuxtLink>
        </div>
      </div>

      <div v-if="loadError" class="error-msg">{{ loadError }}</div>
      <div v-if="successMsg" class="success-msg">{{ successMsg }}</div>
      <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

      <div v-if="pending" class="loading">Loading episode…</div>

      <template v-else-if="form.title !== undefined">
        <!-- Publish toggle banner -->
        <div :class="['publish-banner', form.status]">
          <span>
            Status: <strong>{{ statusLabel }}</strong>
            <span v-if="form.status === 'published' && form.published_at">
              on {{ formatDate(form.published_at) }}
            </span>
            <span v-else-if="form.status === 'scheduled' && form.published_at">
              for {{ formatDateTime(form.published_at) }}
            </span>
          </span>
          <button
            v-if="form.status === 'draft'"
            @click="togglePublish"
            class="btn-publish-toggle"
            :disabled="saving"
          >
            {{ publishedAtIsFuture ? 'Schedule' : 'Publish Now' }}
          </button>
          <button
            v-else
            @click="togglePublish"
            class="btn-unpublish-toggle"
            :disabled="saving"
          >
            Revert to Draft
          </button>
        </div>

        <form @submit.prevent="saveEpisode" class="episode-form">
          <div class="form-section">
            <h2>Basic Info</h2>
            <div class="form-row">
              <div class="form-group flex-2">
                <label for="title">Title <span class="required">*</span></label>
                <input id="title" v-model="form.title" type="text" required />
              </div>
              <div class="form-group">
                <label for="episode_number">Episode #</label>
                <input id="episode_number" v-model.number="form.episode_number" type="number" min="1" />
              </div>
              <div class="form-group">
                <label for="season_number">Season #</label>
                <input id="season_number" v-model.number="form.season_number" type="number" min="1" />
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
                <span class="hint">/episodes/<em>{{ form.slug }}</em></span>
              </label>
              <input id="slug" v-model="form.slug" type="text" />
            </div>

            <div class="form-group">
              <label for="description">Show Notes / Description</label>
              <RichTextEditor v-model="form.description" :rows="12" />
            </div>

            <div class="form-group">
              <label for="tags">Tags</label>
              <input id="tags" v-model="form.tags" type="text" placeholder="comma-separated" />
            </div>
          </div>

          <div class="form-section">
            <h2>Audio</h2>
            <div class="form-group">
              <label for="audio_file">Replace Audio File</label>
              <input
                id="audio_file"
                type="file"
                accept="audio/*"
                @change="handleFileChange"
                class="file-input"
              />
            </div>

            <div v-if="uploading" class="upload-progress">
              <div class="progress-text">Uploading audio… {{ uploadProgress }}%</div>
              <div class="progress-bar-track">
                <div class="progress-bar-fill" :style="{ width: uploadProgress + '%' }"></div>
              </div>
            </div>

            <div v-if="form.audio_url" class="current-audio">
              <strong>Current:</strong>
              <a :href="form.audio_url" target="_blank" rel="noopener">{{ form.audio_filename || form.audio_url }}</a>
            </div>

            <div class="form-group">
              <label for="audio_url">Audio URL</label>
              <div class="input-with-action">
                <input id="audio_url" v-model="form.audio_url" type="url" />
                <button
                  type="button"
                  class="btn-probe"
                  :disabled="!form.audio_url || probing"
                  @click="probeAudio"
                >
                  {{ probing ? 'Checking…' : 'Check File' }}
                </button>
              </div>
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
            <p class="hint">Optional. Falls back to the podcast's main artwork in the RSS feed when unset.</p>

            <div v-if="form.image_url" class="artwork-preview">
              <img :src="form.image_url" :alt="form.title || 'Episode artwork'" class="artwork-thumb" />
              <div class="artwork-meta">
                <strong>Current:</strong>
                <a :href="form.image_url" target="_blank" rel="noopener">{{ form.image_filename || form.image_url }}</a>
              </div>
              <button type="button" class="btn-secondary btn-clear-artwork" @click="form.image_url = ''; form.image_filename = ''">Clear</button>
            </div>

            <div class="form-group">
              <label for="image_file">Replace Artwork</label>
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
            </div>
          </div>

          <ArtworkPicker
            :open="pickerOpen"
            :podcast-slug="podcastSlug"
            @close="pickerOpen = false"
            @select="onArtworkPicked"
          />

          <div class="form-section">
            <h2>People</h2>
            <p class="hint section-hint">
              Manage the show's roster on the
              <NuxtLink :to="`/podcasts/${podcastSlug}/people`">People page</NuxtLink>.
              Role and group are captured at attach time so changing a person's
              defaults later won't rewrite this episode.
            </p>

            <div v-if="episodePeople.length === 0" class="empty-people">No one attached to this episode yet.</div>
            <ul v-else class="attached-list">
              <li v-for="ap in episodePeople" :key="ap.id" class="attached-row">
                <div class="attached-avatar">
                  <img v-if="ap.img_url" :src="ap.img_url" :alt="ap.name" />
                  <span v-else>{{ ap.name.charAt(0).toUpperCase() }}</span>
                </div>
                <div class="attached-meta">
                  <strong>{{ ap.name }}</strong>
                  <span class="attached-tags">
                    <span class="tag">{{ ap.role }}</span>
                    <span class="tag">{{ ap.group }}</span>
                  </span>
                </div>
                <button type="button" class="btn-link danger" @click="detachPerson(ap.id)">Remove</button>
              </li>
            </ul>

            <div class="attach-row" v-if="availableToAttach.length">
              <select v-model.number="attachPersonId" class="attach-select">
                <option :value="0">Add a person…</option>
                <option v-for="p in availableToAttach" :key="p.id" :value="p.id">
                  {{ p.name }} ({{ p.default_role }})
                </option>
              </select>
              <input v-model="attachRole" type="text" placeholder="role override (optional)" class="attach-input" />
              <input v-model="attachGroup" type="text" placeholder="group override (optional)" class="attach-input" />
              <button type="button" class="btn-secondary" :disabled="!attachPersonId" @click="attachPerson">Attach</button>
            </div>
            <p v-else-if="!peopleRosterLoading && !roster.length" class="hint">
              No people in the roster yet.
              <NuxtLink :to="`/podcasts/${podcastSlug}/people`">Add some →</NuxtLink>
            </p>
          </div>

          <div class="form-section">
            <h2>Transcript</h2>
            <p class="hint section-hint">
              Upload a transcript file or paste a public URL. Emits <code>podcast:transcript</code> in the feed.
            </p>

            <div v-if="form.transcript_path" class="current-file">
              <strong>Current:</strong>
              <a :href="form.transcript_path" target="_blank" rel="noopener">{{ form.transcript_path }}</a>
              <button type="button" class="btn-secondary btn-clear" @click="form.transcript_path = ''; form.transcript_type = ''">Clear</button>
            </div>

            <div class="form-group">
              <label for="transcript_file">Upload transcript</label>
              <input
                id="transcript_file"
                type="file"
                accept=".html,.htm,.txt,.srt,.vtt,.json,text/html,text/plain,text/vtt,application/srt,application/x-subrip,application/json"
                @change="handleTranscriptChange"
                class="file-input"
              />
              <p class="hint">HTML, plain text, SRT, WebVTT, or JSON. Goes into your audio directory next to the MP3.</p>
            </div>

            <div v-if="transcriptUploading" class="upload-progress">Uploading transcript… {{ uploadProgress }}%</div>
            <div v-if="transcriptError" class="probe-error">{{ transcriptError }}</div>

            <div class="form-row">
              <div class="form-group flex-2">
                <label for="transcript_path">Transcript URL</label>
                <input id="transcript_path" v-model="form.transcript_path" type="url" placeholder="https://example.com/episode-42.html" />
              </div>
              <div class="form-group">
                <label for="transcript_type">Type</label>
                <select id="transcript_type" v-model="form.transcript_type">
                  <option value="">Auto-detect from URL</option>
                  <option value="text/html">HTML</option>
                  <option value="text/plain">Plain text</option>
                  <option value="application/srt">SRT</option>
                  <option value="text/vtt">WebVTT</option>
                  <option value="application/json">JSON (closed captions)</option>
                </select>
              </div>
            </div>
          </div>

          <div class="form-section">
            <h2>Chapters</h2>
            <p class="hint section-hint">
              Upload a Podcasting 2.0 chapters JSON file, or paste a list below — Podshelf will build and upload the JSON for you.
              Emits <code>podcast:chapters</code> in the feed.
            </p>

            <div v-if="form.chapters_url" class="current-file">
              <strong>Current:</strong>
              <a :href="form.chapters_url" target="_blank" rel="noopener">{{ form.chapters_url }}</a>
              <button type="button" class="btn-secondary btn-clear" @click="form.chapters_url = ''">Clear</button>
            </div>

            <div class="form-group">
              <label for="chapters_file">Upload chapters JSON</label>
              <input
                id="chapters_file"
                type="file"
                accept=".json,application/json"
                @change="handleChaptersFileChange"
                class="file-input"
              />
              <p class="hint">Upload a pre-built JSON file. <a href="https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/examples/chapters/jsonChapters.md" target="_blank" rel="noopener">Spec</a>.</p>
            </div>

            <div v-if="chaptersFileUploading" class="upload-progress">Uploading chapters… {{ uploadProgress }}%</div>
            <div v-if="chaptersFileError" class="probe-error">{{ chaptersFileError }}</div>

            <div class="chapters-divider"><span>or paste a list</span></div>

            <textarea v-model="chaptersText" rows="8" class="chapters-textarea"
              placeholder="00:00 Intro&#10;05:30 Topic one | https://example.com/topic-one&#10;12:15 Guest interview"></textarea>
            <p class="hint">One per line as <code>MM:SS Title</code> or <code>HH:MM:SS Title</code>. Optional URL after <code> | </code>.</p>
            <div class="chapters-actions">
              <span class="spacer"></span>
              <button type="button" class="btn-secondary" :disabled="chaptersSaving" @click="saveChapters">
                {{ chaptersSaving ? 'Uploading…' : 'Build & Save Chapters' }}
              </button>
            </div>
            <div v-if="chaptersMsg" class="probe-error chapters-msg" :class="{ ok: chaptersMsgOk }">{{ chaptersMsg }}</div>
          </div>

          <div class="form-section">
            <h2>Per-episode RSS overrides</h2>
            <p class="hint section-hint">All optional. Override the channel-level defaults for this single episode.</p>

            <div class="form-row">
              <div class="form-group flex-2">
                <label for="itunes_title">Clean title (<code>itunes:title</code>)</label>
                <input id="itunes_title" v-model="form.itunes_title" type="text"
                  placeholder='Without "S2E22:" prefix' />
                <p class="hint">Some apps display this instead of <code>&lt;title&gt;</code>.</p>
              </div>
              <div class="form-group">
                <label for="itunes_explicit">Explicit override</label>
                <select id="itunes_explicit" v-model="form.itunes_explicit">
                  <option value="">Inherit channel default</option>
                  <option value="false">No (Clean)</option>
                  <option value="true">Yes (Explicit)</option>
                </select>
              </div>
            </div>

            <div class="form-group">
              <label for="itunes_author">Author override (<code>itunes:author</code>)</label>
              <input id="itunes_author" v-model="form.itunes_author" type="text" placeholder='e.g. "Jane Doe with guest John Roe"' />
              <p class="hint">Override the channel author for this episode (guest hosts, etc).</p>
            </div>

            <div class="form-row">
              <div class="form-group flex-2">
                <label for="season_name">Season name</label>
                <input id="season_name" v-model="form.season_name" type="text" placeholder='e.g. "Series 1"' />
                <p class="hint">Emitted as <code>name</code> attr on <code>podcast:season</code>.</p>
              </div>
              <div class="form-group flex-2">
                <label for="episode_display">Episode display</label>
                <input id="episode_display" v-model="form.episode_display" type="text" placeholder='e.g. "S2E22"' />
                <p class="hint">Emitted as <code>display</code> attr on <code>podcast:episode</code>.</p>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="ep_license_identifier">License override</label>
                <input id="ep_license_identifier" v-model="form.license_identifier" type="text" placeholder="CC-BY-4.0" />
                <p class="hint">Per-episode license. Overrides the channel license.</p>
              </div>
              <div class="form-group flex-2">
                <label for="ep_license_url">License URL</label>
                <input id="ep_license_url" v-model="form.license_url" type="url" placeholder="https://creativecommons.org/licenses/by/4.0/" />
              </div>
            </div>
          </div>

          <div class="form-section">
            <h2>Publishing</h2>
            <div class="form-row">
              <div class="form-group">
                <label for="status">Status</label>
                <select id="status" v-model="form.status">
                  <option value="draft">Draft</option>
                  <option value="scheduled" :disabled="!publishedAtIsFuture">Scheduled</option>
                  <option value="published">Published</option>
                </select>
                <p class="hint">Setting status to "Published" with a future date saves as Scheduled and auto-publishes at the chosen time.</p>
              </div>
              <div class="form-group flex-2">
                <label for="published_at">Publish Date</label>
                <input id="published_at" v-model="form.published_at" type="datetime-local" />
              </div>
            </div>
          </div>

          <div class="form-actions">
            <span v-if="saving" class="save-status saving">Saving…</span>
            <span v-else-if="justSaved" class="save-status ok">✓ Saved</span>
            <span v-else-if="errorMsg" class="save-status err">✗ {{ errorMsg }}</span>
            <NuxtLink :to="`/podcasts/${podcastSlug}/episodes`" class="btn-secondary">Cancel</NuxtLink>
            <button type="submit" class="btn-primary" :disabled="saving">
              {{ saving ? 'Saving…' : 'Save Changes' }}
            </button>
          </div>
        </form>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Episode } from '~/composables/useEpisodes'

definePageMeta({ middleware: 'auth' })

const route = useRoute()
const id = Number(route.params.id)
const podcastSlug = route.params.slug as string
const { updateEpisode } = useEpisodes(podcastSlug)

const pending = ref(true)
const saving = ref(false)
const justSaved = ref(false)
const { uploading, uploadProgress, uploadFile } = useUpload(podcastSlug)
const loadError = ref('')
const errorMsg = ref('')
const successMsg = ref('')
const probing = ref(false)
const probeError = ref('')
const fieldsUnlocked = ref(false)
const formDirty = ref(false)
const formSaved = ref(false)

interface EpisodeForm {
  title: string
  slug: string
  episode_number: number | null
  season_number: number | null
  description: string
  audio_url: string
  audio_filename: string
  audio_size_bytes: number | null
  audio_duration_seconds: number | null
  image_url: string
  image_filename: string
  published_at: string
  status: string
  tags: string
  transcript_path: string
  transcript_type: string
  chapters_url: string
  episode_type: string
  itunes_title: string
  itunes_author: string
  itunes_explicit: string
  season_name: string
  episode_display: string
  license_identifier: string
  license_url: string
}

const form = reactive<EpisodeForm>({
  title: '',
  slug: '',
  episode_number: null,
  season_number: null,
  description: '',
  audio_url: '',
  audio_filename: '',
  audio_size_bytes: null,
  audio_duration_seconds: null,
  image_url: '',
  image_filename: '',
  published_at: '',
  status: 'draft',
  tags: '',
  transcript_path: '',
  transcript_type: '',
  chapters_url: '',
  episode_type: 'full',
  itunes_title: '',
  itunes_author: '',
  itunes_explicit: '',
  season_name: '',
  episode_display: '',
  license_identifier: '',
  license_url: '',
})

interface RosterPerson {
  id: number
  name: string
  img_url: string | null
  href: string | null
  default_role: string
  default_group: string
  auto_attach: number
}
interface AttachedPerson {
  id: number
  episode_id: number
  person_id: number
  role: string
  group: string
  position: number
  name: string
  img_url: string | null
  href: string | null
}

const roster = ref<RosterPerson[]>([])
const peopleRosterLoading = ref(true)
const episodePeople = ref<AttachedPerson[]>([])
const attachPersonId = ref<number>(0)
const attachRole = ref('')
const attachGroup = ref('')
const chaptersText = ref('')
const chaptersSaving = ref(false)
const chaptersMsg = ref('')
const chaptersMsgOk = ref(false)
const transcriptUploading = ref(false)
const transcriptError = ref('')
const duplicating = ref(false)

async function duplicateEpisode() {
  duplicating.value = true
  errorMsg.value = ''
  try {
    const newEp = await $fetch<{ id: number }>(
      `/api/podcasts/${podcastSlug}/episodes/${id}/duplicate`,
      { method: 'POST' },
    )
    formSaved.value = true
    await navigateTo(`/podcasts/${podcastSlug}/episodes/${newEp.id}`)
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
      || (err instanceof Error ? err.message : 'Duplicate failed')
  } finally {
    duplicating.value = false
  }
}
const chaptersFileUploading = ref(false)
const chaptersFileError = ref('')

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

async function handleChaptersFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  chaptersFileError.value = ''
  chaptersFileUploading.value = true
  try {
    const result = await uploadFile(file, 'chapters')
    form.chapters_url = result.url
    // Persist on the episode row so the feed picks it up — same DB column the
    // textarea path writes to. Saved via the chapters endpoint with empty text
    // to keep the URL but no parse step (we just took an externally-built file).
    await $fetch(`/api/podcasts/${podcastSlug}/episodes/${id}`, {
      method: 'PATCH',
      body: { chapters_url: result.url },
    })
  } catch (err: unknown) {
    chaptersFileError.value = err instanceof Error ? err.message : 'Upload failed'
  } finally {
    chaptersFileUploading.value = false
    input.value = ''
  }
}

const availableToAttach = computed(() => {
  const attachedIds = new Set(episodePeople.value.map((p) => p.person_id))
  return roster.value.filter((p) => !attachedIds.has(p.id))
})

async function loadRoster() {
  peopleRosterLoading.value = true
  try {
    roster.value = await $fetch<RosterPerson[]>(`/api/podcasts/${podcastSlug}/people`)
  } finally {
    peopleRosterLoading.value = false
  }
}

async function loadEpisodePeople() {
  episodePeople.value = await $fetch<AttachedPerson[]>(`/api/podcasts/${podcastSlug}/episodes/${id}/people`)
}

async function attachPerson() {
  if (!attachPersonId.value) return
  try {
    await $fetch(`/api/podcasts/${podcastSlug}/episodes/${id}/people`, {
      method: 'POST',
      body: {
        person_id: attachPersonId.value,
        role: attachRole.value.trim() || undefined,
        group: attachGroup.value.trim() || undefined,
      },
    })
    attachPersonId.value = 0
    attachRole.value = ''
    attachGroup.value = ''
    await loadEpisodePeople()
  } catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : 'Failed to attach person'
  }
}

async function detachPerson(attachId: number) {
  try {
    await $fetch(`/api/podcasts/${podcastSlug}/episodes/${id}/people/${attachId}`, { method: 'DELETE' })
    await loadEpisodePeople()
  } catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : 'Failed to detach person'
  }
}

async function saveChapters() {
  chaptersSaving.value = true
  chaptersMsg.value = ''
  try {
    const result = await $fetch<{ chapters_url: string | null; count: number }>(
      `/api/podcasts/${podcastSlug}/episodes/${id}/chapters`,
      { method: 'POST', body: { text: chaptersText.value } }
    )
    form.chapters_url = result.chapters_url || ''
    chaptersMsg.value = result.count > 0
      ? `Uploaded ${result.count} chapter${result.count === 1 ? '' : 's'}.`
      : 'Chapters cleared.'
    chaptersMsgOk.value = true
  } catch (err: unknown) {
    chaptersMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
      || (err instanceof Error ? err.message : 'Failed to save chapters')
    chaptersMsgOk.value = false
  } finally {
    chaptersSaving.value = false
    setTimeout(() => { chaptersMsg.value = '' }, 4000)
  }
}

const artworkUploading = ref(false)
const artworkError = ref('')

// Load episode
onMounted(async () => {
  try {
    const episodes = await $fetch<Episode[]>(`/api/podcasts/${podcastSlug}/episodes`)
    const ep = episodes.find((e) => e.id === id)
    if (!ep) {
      loadError.value = 'Episode not found.'
      return
    }
    Object.assign(form, {
      title: ep.title,
      slug: ep.slug,
      episode_number: ep.episode_number,
      season_number: ep.season_number,
      description: ep.description || '',
      audio_url: ep.audio_url || '',
      audio_filename: ep.audio_filename || '',
      audio_size_bytes: ep.audio_size_bytes,
      audio_duration_seconds: ep.audio_duration_seconds,
      image_url: ep.image_url || '',
      image_filename: ep.image_filename || '',
      published_at: ep.published_at ? ep.published_at.slice(0, 16) : '',
      status: ep.status,
      tags: ep.tags || '',
      transcript_path: ep.transcript_path || '',
      transcript_type: ep.transcript_type || '',
      chapters_url: ep.chapters_url || '',
      episode_type: ep.episode_type || 'full',
      itunes_title: ep.itunes_title || '',
      itunes_author: ep.itunes_author || '',
      itunes_explicit: ep.itunes_explicit || '',
      season_name: ep.season_name || '',
      episode_display: ep.episode_display || '',
      license_identifier: ep.license_identifier || '',
      license_url: ep.license_url || '',
    })

    await Promise.all([loadRoster(), loadEpisodePeople()])
  } catch (err: unknown) {
    loadError.value = err instanceof Error ? err.message : 'Failed to load episode'
  } finally {
    pending.value = false
    // Start tracking dirty state after form is loaded
    nextTick(() => {
      watch(form, () => { formDirty.value = true }, { deep: true })
    })
  }
})

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (formDirty.value && !formSaved.value) {
    e.preventDefault()
  }
}

onMounted(() => {
  window.addEventListener('beforeunload', onBeforeUnload)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
})

onBeforeRouteLeave(() => {
  if (formDirty.value && !formSaved.value) {
    return window.confirm('You have unsaved changes. Leave anyway?')
  }
})

async function saveEpisode() {
  saving.value = true
  errorMsg.value = ''
  successMsg.value = ''

  try {
    await updateEpisode(id, {
      ...form,
      episode_number: form.episode_number || null,
      season_number: form.season_number || null,
      audio_size_bytes: form.audio_size_bytes || null,
      audio_duration_seconds: form.audio_duration_seconds || null,
      published_at: form.published_at || null,
    })
    formDirty.value = false
    successMsg.value = 'Episode saved successfully.'
    justSaved.value = true
    setTimeout(() => { justSaved.value = false }, 3500)
  } catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : 'Failed to save episode'
  } finally {
    saving.value = false
  }
}

async function togglePublish() {
  if (form.status === 'draft') {
    form.status = 'published'
    if (!form.published_at) {
      form.published_at = new Date().toISOString().slice(0, 16)
    }
    // The server coerces to 'scheduled' automatically when published_at is in the future.
  } else {
    form.status = 'draft'
  }
  await saveEpisode()
}

const publishedAtIsFuture = computed(() => {
  if (!form.published_at) return false
  const t = new Date(form.published_at).getTime()
  return Number.isFinite(t) && t > Date.now()
})

const statusLabel = computed(() => {
  if (form.status === 'published') return 'Published'
  if (form.status === 'scheduled') return 'Scheduled'
  return 'Draft'
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
    const probe = await $fetch<{ size: number | null; contentType: string | null }>(
      '/api/audio-probe',
      { query: { url: form.audio_url } }
    )
    if (probe.size) {
      form.audio_size_bytes = probe.size
    }

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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

useHead({ title: () => `Edit: ${form.title || '…'} — Podshelf Admin` })
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

h1 { margin: 0; font-size: 1.5rem; color: #1a202c; }

.header-actions { display: flex; gap: 0.75rem; align-items: center; }

.btn-back, .btn-preview {
  font-size: 0.875rem;
  color: #667eea;
  text-decoration: none;
}
.btn-back:hover, .btn-preview:hover { text-decoration: underline; }

.publish-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.875rem 1.25rem;
  border-radius: 8px;
  margin-bottom: 1.25rem;
  font-size: 0.9rem;
}
.publish-banner.published {
  background: #f0fff4;
  border: 1px solid #9ae6b4;
  color: #276749;
}
.publish-banner.draft {
  background: #fffff0;
  border: 1px solid #faf089;
  color: #744210;
}
.publish-banner.scheduled {
  background: #ebf4ff;
  border: 1px solid #c3dafe;
  color: #4c51bf;
}

.btn-publish-toggle {
  padding: 0.4rem 0.875rem;
  background: #38a169;
  color: white;
  border: none;
  border-radius: 5px;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-publish-toggle:hover:not(:disabled) { background: #2f855a; }

.btn-unpublish-toggle {
  padding: 0.4rem 0.875rem;
  background: white;
  color: #c53030;
  border: 1px solid #fc8181;
  border-radius: 5px;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-unpublish-toggle:hover:not(:disabled) { background: #fff5f5; }

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

.form-group { margin-bottom: 1rem; }
.form-group:last-child { margin-bottom: 0; }

.form-row { display: flex; gap: 1rem; }
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
.hint { font-size: 0.78rem; color: #718096; margin-left: 0.5rem; font-weight: 400; }

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
  outline: none;
  transition: border-color 0.15s;
}
input:focus, select:focus, textarea:focus {
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
}
textarea { resize: vertical; line-height: 1.6; }
.file-input { padding: 0.375rem; background: #f7fafc; }

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

.current-audio {
  font-size: 0.85rem;
  color: #4a5568;
  margin-bottom: 1rem;
  padding: 0.5rem 0.75rem;
  background: #f7fafc;
  border-radius: 5px;
}
.current-audio a { color: #667eea; word-break: break-all; }

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
  transition: background 0.15s;
}
.btn-primary:hover:not(:disabled) { background: #5a67d8; }

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
  font-size: 0.9rem;
}
.error-msg {
  background: #fff5f5;
  border: 1px solid #fc8181;
  color: #c53030;
  padding: 0.875rem 1rem;
  border-radius: 8px;
  margin-bottom: 1rem;
  font-size: 0.9rem;
}
.loading { color: #718096; padding: 2rem 0; }

.section-hint {
  margin: -0.5rem 0 1rem;
  display: block;
  font-size: 0.82rem;
  color: #4a5568;
  margin-left: 0;
}
.section-hint a { color: #667eea; }
.section-hint code {
  background: #edf2f7;
  padding: 0.1em 0.35em;
  border-radius: 3px;
  font-size: 0.85em;
}

.empty-people { color: #718096; padding: 0.75rem 0; font-size: 0.875rem; }

.attached-list { list-style: none; margin: 0 0 1rem; padding: 0; }
.attached-row {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.5rem 0.625rem;
  background: #f7fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  margin-bottom: 0.5rem;
}
.attached-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #edf2f7;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
  font-weight: 600;
  color: #4a5568;
}
.attached-avatar img { width: 100%; height: 100%; object-fit: cover; }
.attached-meta { flex: 1; display: flex; flex-direction: column; gap: 0.15rem; }
.attached-meta strong { color: #1a202c; }
.attached-tags { display: flex; gap: 0.375rem; }
.tag {
  font-size: 0.72rem;
  background: #edf2f7;
  color: #4a5568;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
}

.attach-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}
.attach-select { flex: 2; min-width: 200px; }
.attach-input { flex: 1; min-width: 120px; }
.attach-row .btn-secondary {
  padding: 0.5rem 0.875rem;
  font-size: 0.85rem;
}

.btn-link {
  background: none;
  border: none;
  color: #667eea;
  cursor: pointer;
  font-size: 0.85rem;
  padding: 0.25rem 0.5rem;
}
.btn-link:hover { text-decoration: underline; }
.btn-link.danger { color: #c53030; }

.chapters-textarea {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.85rem;
  width: 100%;
  padding: 0.6rem 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: white;
  resize: vertical;
  min-height: 140px;
  outline: none;
}
.chapters-textarea:focus {
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
}

.chapters-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.625rem;
  flex-wrap: wrap;
}
.chapters-actions .spacer { flex: 1; }
.chapters-url {
  font-size: 0.78rem;
  color: #4a5568;
  word-break: break-all;
}
.chapters-url a { color: #667eea; }

.chapters-msg.ok {
  background: #f0fff4;
  border: 1px solid #9ae6b4;
  color: #276749;
  margin-top: 0.5rem;
}

.current-file {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.5rem 0.75rem;
  background: #f7fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  margin-bottom: 1rem;
  font-size: 0.85rem;
  color: #4a5568;
  flex-wrap: wrap;
}
.current-file a {
  color: #667eea;
  word-break: break-all;
  flex: 1;
  min-width: 0;
}
.btn-clear {
  flex-shrink: 0;
  padding: 0.3rem 0.7rem;
  font-size: 0.78rem;
}

.chapters-divider {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 1rem 0 0.625rem;
  color: #a0aec0;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.chapters-divider::before,
.chapters-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #e2e8f0;
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
  .page-header {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }
  .header-actions { justify-content: flex-end; }
  .form-row { flex-direction: column; gap: 0; }
  .publish-banner {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }
  .publish-banner .btn-publish-toggle,
  .publish-banner .btn-unpublish-toggle { align-self: stretch; }
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
  .form-actions .btn-secondary { flex: 1 1 auto; text-align: center; }
  .form-actions .save-status {
    flex-basis: 100%;
    margin-right: 0;
    text-align: center;
  }
}
</style>
