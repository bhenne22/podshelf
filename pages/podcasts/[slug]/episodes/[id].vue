<template>
  <div class="admin-page">
    <AdminNav :podcast-slug="podcastSlug" />
    <div class="container">
      <div class="page-header">
        <div class="page-header-top">
          <h1>Edit Episode</h1>
          <NuxtLink :to="`/podcasts/${podcastSlug}/episodes`" class="btn-back">← Episodes</NuxtLink>
        </div>

        <nav v-if="allEpisodes.length > 1" class="ep-nav" aria-label="Episode navigation">
          <NuxtLink
            v-if="prevEpisode"
            :to="`/podcasts/${podcastSlug}/episodes/${prevEpisode.id}`"
            class="ep-nav-link"
          >
            <span class="ep-nav-arrow">←</span>
            <span class="ep-nav-meta">
              <span class="ep-nav-label">Previous (older)</span>
              <span class="ep-nav-title">{{ prevEpisode.title }}</span>
            </span>
          </NuxtLink>
          <span v-else class="ep-nav-link disabled" aria-disabled="true">
            <span class="ep-nav-arrow">←</span>
            <span class="ep-nav-meta">
              <span class="ep-nav-label">Previous (older)</span>
              <span class="ep-nav-title">—</span>
            </span>
          </span>

          <NuxtLink
            v-if="nextEpisode"
            :to="`/podcasts/${podcastSlug}/episodes/${nextEpisode.id}`"
            class="ep-nav-link right"
          >
            <span class="ep-nav-meta">
              <span class="ep-nav-label">Next (newer)</span>
              <span class="ep-nav-title">{{ nextEpisode.title }}</span>
            </span>
            <span class="ep-nav-arrow">→</span>
          </NuxtLink>
          <span v-else class="ep-nav-link right disabled" aria-disabled="true">
            <span class="ep-nav-meta">
              <span class="ep-nav-label">Next (newer)</span>
              <span class="ep-nav-title">—</span>
            </span>
            <span class="ep-nav-arrow">→</span>
          </span>
        </nav>
      </div>

      <div v-if="loadError" class="error-msg">{{ loadError }}</div>
      <div v-if="successMsg" class="success-msg">{{ successMsg }}</div>
      <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

      <div v-if="pending" class="loading">Loading episode…</div>

      <template v-else-if="form.title !== undefined">
        <form @submit.prevent="onSubmit" class="episode-form">
          <div class="form-actions form-actions-top">
            <span v-if="saving" class="save-status saving">Saving…</span>
            <span v-else-if="justSaved" class="save-status ok">✓ Saved</span>
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
            <div class="publishing-header">
              <h2>Publishing</h2>
              <span :class="['status-pill', form.status]">{{ statusLabel }}</span>
            </div>
            <p v-if="form.status === 'published' && form.published_at" class="hint section-hint">
              Live since {{ publishedDateDisplay }}.
            </p>
            <p v-else-if="form.status === 'scheduled' && form.published_at" class="hint section-hint">
              Scheduled for {{ publishedDateTimeDisplay }}.
            </p>
            <p v-else class="hint section-hint">
              Currently a draft. Set a publish date to schedule, or publish immediately.
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
            <h2>Recording</h2>
            <p class="hint section-hint">
              Optional. Adds a timed event to the calendar feed for the
              recording session itself. Independent of the publish date.
            </p>

            <div class="form-row">
              <div class="form-group flex-2">
                <label for="recording_starts_at">Recording date &amp; time</label>
                <input id="recording_starts_at"
                  v-model="form.recording_starts_at"
                  type="datetime-local" />
                <p class="hint">Times are in the podcast's timezone: <strong>{{ podcastTz }}</strong> ({{ tzAbbr }}).</p>
              </div>
              <div class="form-group">
                <label for="recording_duration_minutes">Duration (minutes)</label>
                <input id="recording_duration_minutes"
                  v-model.number="form.recording_duration_minutes"
                  type="number" min="1" step="1"
                  :placeholder="String(recordingDurationDefault)" />
              </div>
            </div>
          </div>

          <div class="form-section">
            <h2>Basic Info</h2>
            <div class="form-row">
              <div class="form-group flex-2">
                <label for="title">Title <span class="required">*</span></label>
                <input id="title" v-model="form.title" type="text" required />
              </div>
              <div v-if="episodeNumbersEnabled" class="form-group">
                <label for="episode_number">Episode #</label>
                <input id="episode_number" v-model.number="form.episode_number" type="number" min="1" />
              </div>
              <div v-if="seasonsEnabled" class="form-group">
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
              <p class="hint">JPEG, PNG, or WebP. After selecting, crop to 1400×1400 in-browser before upload.</p>
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

          <ArtworkCropper
            :open="cropperOpen"
            :src="cropperSrc"
            :filename="cropperFilename"
            @cancel="closeCropper"
            @cropped="onCropperSaved"
          />

          <SidecarPicker
            :open="transcriptPickerOpen"
            :podcast-slug="podcastSlug"
            title="Choose Transcript"
            :extensions="['.srt', '.vtt', '.json', '.html', '.htm', '.txt']"
            @close="transcriptPickerOpen = false"
            @select="onTranscriptPicked"
          />

          <SidecarPicker
            :open="chaptersPickerOpen"
            :podcast-slug="podcastSlug"
            title="Choose Chapters JSON"
            :extensions="['.json']"
            @close="chaptersPickerOpen = false"
            @select="onChaptersPicked"
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
              <label for="transcript_file">Upload or pick transcript</label>
              <div class="upload-and-pick">
                <input
                  id="transcript_file"
                  type="file"
                  accept=".html,.htm,.txt,.srt,.vtt,.json,text/html,text/plain,text/vtt,application/srt,application/x-subrip,application/json"
                  @change="handleTranscriptChange"
                  class="file-input"
                />
                <button type="button" class="btn-secondary" @click="transcriptPickerOpen = true">Pick from files</button>
              </div>
              <p class="hint">HTML, plain text, SRT, WebVTT, or JSON. Goes into your audio directory next to the MP3.</p>
            </div>

            <div v-if="transcriptUploading" class="upload-progress">Uploading transcript… {{ uploadProgress }}%</div>
            <div v-if="transcriptError" class="probe-error">{{ transcriptError }}</div>

            <div class="form-row">
              <div class="form-group flex-2">
                <label for="transcript_path">Transcript URL</label>
                <div class="input-with-action">
                  <input id="transcript_path" v-model="form.transcript_path" type="url" placeholder="https://example.com/episode-42.html" />
                  <button
                    type="button"
                    class="btn-probe"
                    :disabled="!form.transcript_path || transcriptProbing"
                    @click="probeTranscript"
                  >
                    {{ transcriptProbing ? 'Checking…' : 'Check File' }}
                  </button>
                </div>
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

            <div v-if="transcriptProbe" class="probe-result" :class="{ ok: transcriptProbe.ok && transcriptProbe.reachable, bad: !transcriptProbe.ok || !transcriptProbe.reachable }">
              <div v-if="!transcriptProbe.reachable" class="probe-line">
                <strong>Unreachable.</strong> {{ transcriptProbe.errors[0] }}
              </div>
              <template v-else-if="transcriptProbe.summary">
                <div class="probe-line">
                  <strong>{{ String(transcriptProbe.summary.kind).toUpperCase() }}</strong> ·
                  {{ transcriptProbe.summary.cueCount }} cues ·
                  {{ transcriptProbe.summary.durationFormatted }} covered
                  <template v-if="Array.isArray(transcriptProbe.summary.speakers) && transcriptProbe.summary.speakers.length">
                    · speakers: {{ (transcriptProbe.summary.speakers as string[]).join(', ') }}
                  </template>
                </div>
                <div v-if="transcriptProbe.summary.preview" class="probe-preview">
                  {{ transcriptProbe.summary.preview }}
                </div>
              </template>
              <div v-else-if="transcriptProbe.ok" class="probe-line">
                <strong>Reachable.</strong> Format isn't SRT/VTT/JSON — no content summary.
              </div>
              <div v-else class="probe-line">
                <strong>Parse error.</strong>
                <ul class="probe-errors">
                  <li v-for="(e, idx) in transcriptProbe.errors" :key="idx">{{ e }}</li>
                </ul>
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
              <label for="chapters_file">Upload or pick chapters JSON</label>
              <div class="upload-and-pick">
                <input
                  id="chapters_file"
                  type="file"
                  accept=".json,application/json"
                  @change="handleChaptersFileChange"
                  class="file-input"
                />
                <button type="button" class="btn-secondary" @click="chaptersPickerOpen = true">Pick from files</button>
              </div>
              <p class="hint">Upload a pre-built JSON file. <a href="https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/examples/chapters/jsonChapters.md" target="_blank" rel="noopener">Spec</a>.</p>
            </div>

            <div v-if="chaptersFileUploading" class="upload-progress">Uploading chapters… {{ uploadProgress }}%</div>
            <div v-if="chaptersFileError" class="probe-error">{{ chaptersFileError }}</div>

            <div class="form-group">
              <label for="chapters_url">Chapters URL</label>
              <div class="input-with-action">
                <input id="chapters_url" v-model="form.chapters_url" type="url" placeholder="https://example.com/episode-42.chapters.json" />
                <button
                  type="button"
                  class="btn-probe"
                  :disabled="!form.chapters_url || chaptersProbing"
                  @click="probeChapters"
                >
                  {{ chaptersProbing ? 'Checking…' : 'Check File' }}
                </button>
              </div>
              <p class="hint">Or paste an existing public URL to a chapters JSON file hosted elsewhere.</p>
            </div>

            <div v-if="chaptersProbe" class="probe-result" :class="{ ok: chaptersProbe.ok && chaptersProbe.reachable, bad: !chaptersProbe.ok || !chaptersProbe.reachable }">
              <div v-if="!chaptersProbe.reachable" class="probe-line">
                <strong>Unreachable.</strong> {{ chaptersProbe.errors[0] }}
              </div>
              <template v-else-if="chaptersProbe.summary">
                <div class="probe-line">
                  <strong>{{ chaptersProbe.summary.chapterCount }} chapters</strong>
                  <template v-if="chaptersProbe.summary.version">· v{{ chaptersProbe.summary.version }}</template>
                  · last starts at {{ chaptersProbe.summary.lastStartFormatted }}
                </div>
                <div v-if="Array.isArray(chaptersProbe.summary.titles) && chaptersProbe.summary.titles.length" class="probe-preview">
                  {{ (chaptersProbe.summary.titles as string[]).slice(0, 3).join(' • ') }}{{ (chaptersProbe.summary.titles as string[]).length > 3 ? ' • …' : '' }}
                </div>
              </template>
              <div v-else class="probe-line">
                <strong>Validation failed.</strong>
                <ul class="probe-errors">
                  <li v-for="(e, idx) in chaptersProbe.errors" :key="idx">{{ e }}</li>
                </ul>
              </div>
            </div>

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
              <div v-if="seasonsEnabled" class="form-group flex-2">
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

          <div class="form-actions">
            <span v-if="saving" class="save-status saving">Saving…</span>
            <span v-else-if="justSaved" class="save-status ok">✓ Saved</span>
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
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Episode } from '~/composables/useEpisodes'
import { utcIsoToLocalInput, localInputToUtcIso, tzAbbreviation } from '~/utils/datetime-local'

definePageMeta({
  middleware: 'auth',
  // Force a fresh page instance when the episode id changes so onMounted runs
  // again and prev/next navigation reloads the form.
  key: (route) => route.fullPath,
})

const route = useRoute()
const id = Number(route.params.id)
const podcastSlug = route.params.slug as string
const { updateEpisode } = useEpisodes(podcastSlug)

interface PodcastFlags {
  seasons_enabled: number | null
  episode_numbers_enabled: number | null
  timezone: string | null
  recording_default_duration_minutes: number | null
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
const podcastTz = computed(() => podcastSettings.value?.timezone || 'UTC')
const tzAbbr = computed(() => tzAbbreviation(podcastTz.value))
const recordingDurationDefault = computed(() =>
  podcastSettings.value?.recording_default_duration_minutes ?? 90)

// UTC ISO version of the publish-date input for NetworkConflictHint. Tracks
// in-progress edits, not the saved value, so the hint reacts as the host
// changes the date.
const publishAtIso = computed<string | null>(() => {
  if (!form.published_at) return null
  return localInputToUtcIso(form.published_at, podcastTz.value) || null
})

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
  recording_starts_at: string
  recording_duration_minutes: number | null
}

const originalPublishedAt = ref<string | null>(null)
const originalRecordingStartsAt = ref<string | null>(null)

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
  recording_starts_at: '',
  recording_duration_minutes: null,
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
const chaptersFileUploading = ref(false)
const chaptersFileError = ref('')

interface SidecarProbeResult {
  reachable: boolean
  size: number | null
  contentType: string | null
  ok: boolean
  summary: Record<string, unknown> | null
  errors: string[]
}
const transcriptProbe = ref<SidecarProbeResult | null>(null)
const chaptersProbe = ref<SidecarProbeResult | null>(null)
const transcriptProbing = ref(false)
const chaptersProbing = ref(false)

async function probeSidecar(
  kind: 'transcript' | 'chapters',
  url: string,
): Promise<SidecarProbeResult | null> {
  if (!url) return null
  try {
    return await $fetch<SidecarProbeResult>('/api/sidecar-probe', { query: { url, kind } })
  } catch (err: unknown) {
    const msg = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
      || (err instanceof Error ? err.message : 'Probe failed')
    return { reachable: false, size: null, contentType: null, ok: false, summary: null, errors: [msg] }
  }
}

async function probeTranscript() {
  if (!form.transcript_path) return
  transcriptProbing.value = true
  try {
    transcriptProbe.value = await probeSidecar('transcript', form.transcript_path)
  } finally {
    transcriptProbing.value = false
  }
}

async function probeChapters() {
  if (!form.chapters_url) return
  chaptersProbing.value = true
  try {
    chaptersProbe.value = await probeSidecar('chapters', form.chapters_url)
  } finally {
    chaptersProbing.value = false
  }
}

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
    await probeTranscript()
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
    await probeChapters()
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

// Full episode list (in API order: published newest-first, then drafts by created_at DESC).
// Used to power prev/next navigation in the page header.
const allEpisodes = ref<Episode[]>([])

const currentIndex = computed(() =>
  allEpisodes.value.findIndex((e) => e.id === id),
)
// API returns episodes newest-first (DESC by published_at, drafts at the
// end). The user thinks chronologically — Prev = older, Next = newer — so
// we walk the array backwards relative to the index ordering.
const prevEpisode = computed(() => {
  const i = currentIndex.value
  return i >= 0 && i < allEpisodes.value.length - 1 ? allEpisodes.value[i + 1] : null
})
const nextEpisode = computed(() => {
  const i = currentIndex.value
  return i > 0 ? allEpisodes.value[i - 1] : null
})

// Load episode
onMounted(async () => {
  try {
    allEpisodes.value = await $fetch<Episode[]>(`/api/podcasts/${podcastSlug}/episodes`)
    const ep = allEpisodes.value.find((e) => e.id === id)
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
      published_at: utcIsoToLocalInput(ep.published_at, podcastTz.value),
      status: ep.status,
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
      recording_starts_at: utcIsoToLocalInput(ep.recording_starts_at, podcastTz.value),
      recording_duration_minutes: ep.recording_duration_minutes,
    })
    // <input type="datetime-local"> can only round-trip minute precision,
    // so we display the truncated value but remember the full ISO. On save
    // we send the full ISO back if the user didn't change the field;
    // otherwise we send what they typed.
    originalPublishedAt.value = ep.published_at || null
    originalRecordingStartsAt.value = ep.recording_starts_at || null

    await Promise.all([loadRoster(), loadEpisodePeople()])
    // Auto-probe existing sidecars so the editor surfaces broken or
    // malformed files without the user having to click Check.
    if (form.transcript_path) probeTranscript()
    if (form.chapters_url) probeChapters()
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

type SaveAction = 'save_changes' | 'publish_now' | 'schedule' | 'revert_draft'

const publishedAtIsFuture = computed(() => {
  if (!form.published_at) return false
  // form.published_at is a wall-clock string in podcast TZ — convert
  // through the helper rather than letting the Date constructor parse it
  // as browser-local.
  const iso = localInputToUtcIso(form.published_at, podcastTz.value)
  if (!iso) return false
  const t = new Date(iso).getTime()
  return Number.isFinite(t) && t > Date.now()
})

const statusLabel = computed(() => {
  if (form.status === 'published') return 'Published'
  if (form.status === 'scheduled') return 'Scheduled'
  return 'Draft'
})

interface ActionDef {
  key: SaveAction
  label: string
  style: string
  disabled?: boolean
}
// Verbs visible at any moment are scoped to the current status so the user
// never sees an action that doesn't apply. "Save & Schedule" only shows
// when the publish date is in the future — anything else would be a footgun.
const availableActions = computed<ActionDef[]>(() => {
  const list: ActionDef[] = [
    { key: 'save_changes', label: 'Save Changes', style: 'btn-primary' },
  ]
  if (form.status === 'draft') {
    list.push({ key: 'publish_now', label: 'Save & Publish', style: 'btn-publish' })
    if (publishedAtIsFuture.value) {
      list.push({ key: 'schedule', label: 'Save & Schedule', style: 'btn-schedule' })
    }
  } else if (form.status === 'scheduled') {
    list.push({ key: 'publish_now', label: 'Publish Now', style: 'btn-publish' })
    list.push({ key: 'revert_draft', label: 'Revert to Draft', style: 'btn-secondary' })
  } else if (form.status === 'published') {
    list.push({ key: 'revert_draft', label: 'Revert to Draft', style: 'btn-secondary' })
  }
  return list
})

/**
 * Save the episode applying the verb's status/date semantics.
 *   - save_changes: send what's in the form, never touch status
 *   - publish_now:  status='published', published_at=now (overrides date)
 *   - schedule:     status='scheduled', published_at=future date in form
 *   - revert_draft: status='draft', keep published_at (so re-publishing
 *                   later restores the original date)
 */
async function saveEpisode(action: SaveAction = 'save_changes') {
  saving.value = true
  errorMsg.value = ''
  successMsg.value = ''

  let nextStatus = form.status
  let publishedAtToSend: string | null

  if (action === 'publish_now') {
    nextStatus = 'published'
    publishedAtToSend = new Date().toISOString()
  } else if (action === 'schedule') {
    publishedAtToSend = localInputToUtcIso(form.published_at, podcastTz.value)
    if (!publishedAtToSend) {
      errorMsg.value = 'Pick a future publish date to schedule.'
      saving.value = false
      return
    }
    nextStatus = 'scheduled'
  } else if (action === 'revert_draft') {
    nextStatus = 'draft'
    // Preserve the original UTC ISO when present so a later Publish Now /
    // Save & Schedule has a sensible default to work from.
    publishedAtToSend = originalPublishedAt.value
  } else {
    // save_changes — preserve full-precision ISO when the user didn't
    // touch the field; otherwise convert the wall-clock entry.
    if (form.published_at) {
      const originalAsLocalInput = utcIsoToLocalInput(originalPublishedAt.value, podcastTz.value)
      publishedAtToSend = originalPublishedAt.value && form.published_at === originalAsLocalInput
        ? originalPublishedAt.value
        : localInputToUtcIso(form.published_at, podcastTz.value)
    } else {
      publishedAtToSend = null
    }
  }

  // Same precision-preservation game as published_at: round-trip the full
  // server ISO if the user didn't touch the field; otherwise convert what
  // they typed.
  let recordingStartsAtToSend: string | null
  if (form.recording_starts_at) {
    const originalAsLocalInput = utcIsoToLocalInput(originalRecordingStartsAt.value, podcastTz.value)
    recordingStartsAtToSend = originalRecordingStartsAt.value
        && form.recording_starts_at === originalAsLocalInput
      ? originalRecordingStartsAt.value
      : localInputToUtcIso(form.recording_starts_at, podcastTz.value)
  } else {
    recordingStartsAtToSend = null
  }

  try {
    const updated = await updateEpisode(id, {
      ...form,
      status: nextStatus,
      episode_number: form.episode_number || null,
      season_number: form.season_number || null,
      audio_size_bytes: form.audio_size_bytes || null,
      audio_duration_seconds: form.audio_duration_seconds || null,
      published_at: publishedAtToSend,
      recording_starts_at: recordingStartsAtToSend,
      recording_duration_minutes: form.recording_duration_minutes || null,
    })
    // Sync server-resolved fields back to the form. The server may coerce
    // status (e.g. published+future → scheduled) — reflect that immediately
    // so the visible state matches the persisted state.
    if (updated) {
      if (typeof updated.published_at === 'string' && updated.published_at) {
        form.published_at = utcIsoToLocalInput(updated.published_at, podcastTz.value)
        originalPublishedAt.value = updated.published_at
      } else {
        form.published_at = ''
        originalPublishedAt.value = null
      }
      if (typeof updated.recording_starts_at === 'string' && updated.recording_starts_at) {
        form.recording_starts_at = utcIsoToLocalInput(updated.recording_starts_at, podcastTz.value)
        originalRecordingStartsAt.value = updated.recording_starts_at
      } else {
        form.recording_starts_at = ''
        originalRecordingStartsAt.value = null
      }
      if (typeof updated.status === 'string') form.status = updated.status
    }
    await nextTick()
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

// Submit via Enter defaults to Save Changes — the lowest-stakes verb.
function onSubmit() {
  saveEpisode('save_changes')
}

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
  // Hand off to the cropper. The upload step runs after the user accepts a crop.
  openCropper(file)
  input.value = ''
}

const cropperOpen = ref(false)
const cropperSrc = ref<string | null>(null)
const cropperFilename = ref('')
let cropperRevokeUrl: string | null = null

function openCropper(file: File) {
  if (cropperRevokeUrl) URL.revokeObjectURL(cropperRevokeUrl)
  const url = URL.createObjectURL(file)
  cropperRevokeUrl = url
  cropperSrc.value = url
  cropperFilename.value = file.name
  cropperOpen.value = true
}

function closeCropper() {
  cropperOpen.value = false
  if (cropperRevokeUrl) {
    URL.revokeObjectURL(cropperRevokeUrl)
    cropperRevokeUrl = null
  }
  cropperSrc.value = null
}

async function onCropperSaved(payload: { blob: Blob; filename: string }) {
  closeCropper()
  artworkError.value = ''
  artworkUploading.value = true
  try {
    const file = new File([payload.blob], payload.filename, { type: payload.blob.type })
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

const transcriptPickerOpen = ref(false)
const chaptersPickerOpen = ref(false)

function onTranscriptPicked(payload: { url: string; name: string }) {
  form.transcript_path = payload.url
  // Best-effort content-type from extension so the feed gets the right mime.
  const lower = payload.name.toLowerCase()
  if (lower.endsWith('.srt')) form.transcript_type = 'application/srt'
  else if (lower.endsWith('.vtt')) form.transcript_type = 'text/vtt'
  else if (lower.endsWith('.json')) form.transcript_type = 'application/json'
  else if (lower.endsWith('.html') || lower.endsWith('.htm')) form.transcript_type = 'text/html'
  else if (lower.endsWith('.txt')) form.transcript_type = 'text/plain'
  probeTranscript()
}

function onChaptersPicked(payload: { url: string; name: string }) {
  form.chapters_url = payload.url
  probeChapters()
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

// Render the banner's published-at in the podcast's TZ so a co-host abroad
// sees the same wall-clock the publisher set. The source string is a
// datetime-local value (naive, podcast-TZ), so we convert → UTC ISO
// → toLocaleString with the podcast TZ.
const publishedDateDisplay = computed(() => {
  const iso = localInputToUtcIso(form.published_at, podcastTz.value)
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
    timeZone: podcastTz.value,
  })
})
const publishedDateTimeDisplay = computed(() => {
  const iso = localInputToUtcIso(form.published_at, podcastTz.value)
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: podcastTz.value,
    timeZoneName: 'short',
  })
})

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

.page-header { margin-bottom: 1.5rem; }
.page-header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.875rem;
}

h1 { margin: 0; font-size: 1.5rem; color: #1a202c; }

.btn-back {
  font-size: 0.875rem;
  color: #667eea;
  text-decoration: none;
}
.btn-back:hover { text-decoration: underline; }

/* Prev/Next nav strip */
.ep-nav {
  display: flex;
  gap: 0.75rem;
}
.ep-nav-link {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  flex: 1;
  min-width: 0;
  padding: 0.625rem 0.875rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  text-decoration: none;
  color: #2d3748;
  transition: all 0.15s;
}
.ep-nav-link.right {
  flex-direction: row;
  justify-content: flex-end;
  text-align: right;
}
.ep-nav-link:hover:not(.disabled) {
  border-color: #c3dafe;
  background: #f7fafc;
}
.ep-nav-link.disabled {
  color: #cbd5e0;
  cursor: not-allowed;
  background: #f7fafc;
}
.ep-nav-arrow {
  flex-shrink: 0;
  color: #a0aec0;
  font-size: 1rem;
}
.ep-nav-link:hover:not(.disabled) .ep-nav-arrow { color: #4c51bf; }
.ep-nav-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.ep-nav-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #a0aec0;
  font-weight: 600;
}
.ep-nav-title {
  font-size: 0.85rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
}

.publishing-header {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  margin-bottom: 0.5rem;
}
.publishing-header h2 { margin: 0; }

.status-pill {
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  border: 1px solid transparent;
}
.status-pill.draft {
  background: #fffff0;
  border-color: #faf089;
  color: #744210;
}
.status-pill.scheduled {
  background: #ebf4ff;
  border-color: #c3dafe;
  color: #4c51bf;
}
.status-pill.published {
  background: #f0fff4;
  border-color: #9ae6b4;
  color: #276749;
}

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

.probe-result {
  padding: 0.625rem 0.875rem;
  border-radius: 6px;
  font-size: 0.82rem;
  margin: 0.625rem 0;
  border: 1px solid transparent;
}
.probe-result.ok { background: #f0fdf4; color: #166534; border-color: #bbf7d0; }
.probe-result.bad { background: #fff5f5; color: #c53030; border-color: #feb2b2; }
.probe-line { line-height: 1.5; }
.probe-line strong { font-weight: 600; }
.probe-preview {
  margin-top: 0.35rem;
  font-size: 0.78rem;
  font-style: italic;
  opacity: 0.85;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.probe-errors {
  margin: 0.35rem 0 0;
  padding-left: 1.1rem;
  font-size: 0.78rem;
}
.probe-errors li { margin: 0.1rem 0; }

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
  .page-header-top {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }
  .ep-nav { flex-direction: column; }
  .form-row { flex-direction: column; gap: 0; }
  .publishing-header { flex-wrap: wrap; gap: 0.5rem; }
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
