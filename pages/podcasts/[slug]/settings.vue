<template>
  <div class="admin-page">
    <AdminNav :podcast-slug="podcastSlug" />
    <div class="container">
      <h1>Show Settings</h1>

      <div v-if="successMsg" class="success-msg">{{ successMsg }}</div>
      <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

      <div v-if="pending" class="loading">Loading settings…</div>

      <form v-else @submit.prevent="saveSettings" class="settings-form">
        <div class="form-section">
          <h2>Podcast Identity</h2>

          <div class="form-group">
            <label for="title">Show Title <span class="required">*</span></label>
            <input id="title" v-model="form.title" type="text" required placeholder="My Awesome Podcast" />
          </div>

          <div class="form-group">
            <label for="slug">Slug <span class="required">*</span></label>
            <input id="slug" v-model="form.slug" type="text" required placeholder="my-awesome-podcast"
              :class="{ 'input-invalid': form.slug && !slugValid }" autocomplete="off" />
            <p v-if="form.slug && !slugValid" class="probe-error">
              Use lowercase letters, digits, and hyphens only (e.g. <code>my-show</code>).
            </p>
            <p v-else-if="slugChanged" class="slug-warning">
              <strong>Heads-up:</strong> changing the slug. The old feed URL
              <code>/feeds/{{ originalSlug }}.xml</code> keeps working and emits
              <code>&lt;itunes:new-feed-url&gt;</code> so modern podcast apps auto-migrate
              subscribers. Admin URLs like <code>/podcasts/{{ originalSlug }}/episodes</code>
              <em>will</em> 404 — bookmarks need updating.
            </p>
            <p v-else class="hint">
              Used in the public RSS feed URL (<code>/feeds/{{ originalSlug }}.xml</code>) and admin links.
            </p>
          </div>

          <div v-if="aliases.length" class="form-group">
            <label>Past slugs</label>
            <ul class="alias-list">
              <li v-for="a in aliases" :key="a.id">
                <code>/feeds/{{ a.old_slug }}.xml</code>
                <span class="alias-meta">added {{ formatAliasDate(a.created_at) }}</span>
              </li>
            </ul>
            <p class="hint">Permanent — old slugs are never recycled. Each still serves the feed with a redirect tag pointing at the current URL.</p>
          </div>

          <div class="form-group">
            <label for="description">Description</label>
            <textarea id="description" v-model="form.description" rows="4"
              placeholder="A brief description of your show for podcast directories and your RSS feed."
            ></textarea>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="author">Author / Host Name</label>
              <input id="author" v-model="form.author" type="text" placeholder="Jane Doe" />
            </div>
            <div class="form-group">
              <label for="email">Contact Email</label>
              <input id="email" v-model="form.email" type="email" placeholder="podcast@example.com" />
              <p class="hint">Used in iTunes owner email field of the RSS feed.</p>
            </div>
          </div>

          <div class="form-group">
            <label for="image_url">Podcast Artwork</label>
            <div v-if="form.image_url" class="artwork-preview">
              <img :src="form.image_url" :alt="form.title || 'Podcast artwork'" class="artwork-thumb" />
              <div class="artwork-meta">
                <a :href="form.image_url" target="_blank" rel="noopener">{{ form.image_url }}</a>
              </div>
              <button type="button" class="btn-secondary btn-clear-artwork" @click="form.image_url = ''">Clear</button>
            </div>
            <div class="input-with-action">
              <input id="image_url" v-model="form.image_url" type="url"
                placeholder="https://example.com/podcast-art.jpg" />
              <label class="btn-upload">
                {{ artworkUploading ? `Uploading… ${uploadProgress}%` : 'Upload…' }}
                <input type="file" accept="image/jpeg,image/png,image/webp"
                  :disabled="artworkUploading" @change="handleArtworkChange" hidden />
              </label>
              <button type="button" class="btn-upload" @click="pickerOpen = true">Pick…</button>
            </div>
            <p v-if="artworkError" class="probe-error">{{ artworkError }}</p>
            <p class="hint">Paste a URL, upload, or pick from the artwork gallery. Must be at least 1400×1400px per Apple Podcasts.</p>
          </div>

          <div class="form-group">
            <label for="website">Show Website</label>
            <input id="website" v-model="form.website" type="url"
              placeholder="https://yourpodcast.example.com" />
            <p class="hint">Public site that hosts the podcast pages — RSS &lt;link&gt; entries point here.</p>
          </div>
        </div>

        <div class="form-section">
          <h2>RSS / Directory Settings</h2>

          <div class="form-row">
            <div class="form-group">
              <label for="language">Language</label>
              <input id="language" v-model="form.language" type="text" placeholder="en" />
              <p class="hint">ISO 639-1 code, e.g. en, es, fr</p>
            </div>
            <div class="form-group">
              <label for="category">iTunes Category</label>
              <select id="category" v-model="form.category">
                <option>Arts</option>
                <option>Business</option>
                <option>Comedy</option>
                <option>Education</option>
                <option>Fiction</option>
                <option>Government</option>
                <option>Health & Fitness</option>
                <option>History</option>
                <option>Kids & Family</option>
                <option>Leisure</option>
                <option>Music</option>
                <option>News</option>
                <option>Religion & Spirituality</option>
                <option>Science</option>
                <option>Society & Culture</option>
                <option>Sports</option>
                <option>Technology</option>
                <option>True Crime</option>
                <option>TV & Film</option>
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="explicit">Explicit Content</label>
              <select id="explicit" v-model="form.explicit">
                <option value="false">No (Clean)</option>
                <option value="true">Yes (Explicit)</option>
              </select>
            </div>
            <div class="form-group">
              <label for="copyright">Copyright</label>
              <input id="copyright" v-model="form.copyright" type="text"
                placeholder="© 2025 Jane Doe" />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="itunes_type">Show Type</label>
              <select id="itunes_type" v-model="form.itunes_type">
                <option value="episodic">Episodic (newest first)</option>
                <option value="serial">Serial (listen in order)</option>
              </select>
              <p class="hint">Sets the iTunes <code>itunes:type</code> tag — controls play order in podcast apps.</p>
            </div>
            <div class="form-group">
              <label for="podcast_locked">Feed Locked</label>
              <select id="podcast_locked" v-model="form.podcast_locked">
                <option value="no">No (transferable)</option>
                <option value="yes">Yes (locked to this host)</option>
              </select>
              <p class="hint">Podcasting 2.0 <code>podcast:locked</code> — signals to other hosts whether subscribers can move with the feed.</p>
            </div>
          </div>

          <div class="form-group">
            <label for="audio_tracking_prefix">Audio Tracking Prefix</label>
            <input id="audio_tracking_prefix" v-model="form.audio_tracking_prefix" type="text"
              placeholder="https://media.blubrry.com/1467354/" />
            <p class="hint">Prepended to episode audio URLs in the RSS feed only (e.g. Blubrry, Podtrac).</p>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="itunes_complete">Show Complete</label>
              <select id="itunes_complete" v-model="form.itunes_complete">
                <option value="no">No (still publishing)</option>
                <option value="yes">Yes (no more episodes coming)</option>
              </select>
              <p class="hint">Sets <code>itunes:complete</code>. For limited series — Apple stops polling for new episodes when set.</p>
            </div>
            <div class="form-group">
              <label for="itunes_block">Hide from Directories</label>
              <select id="itunes_block" v-model="form.itunes_block">
                <option value="no">No (visible in Apple/Spotify)</option>
                <option value="yes">Yes (private feed)</option>
              </select>
              <p class="hint">Sets <code>itunes:block</code>. Use for test feeds or private podcasts you don't want indexed.</p>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group flex-2">
              <label for="funding_url">Support / Funding URL</label>
              <input id="funding_url" v-model="form.funding_url" type="url"
                placeholder="https://patreon.com/yourshow" />
              <p class="hint">Optional. Shown as a "Support the Show" button in modern apps (Fountain, Castamatic, Curio).</p>
            </div>
            <div class="form-group">
              <label for="funding_label">Button Label</label>
              <input id="funding_label" v-model="form.funding_label" type="text"
                placeholder="Support on Patreon" />
              <p class="hint">Defaults to "Support the show" if blank.</p>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="license_identifier">License</label>
              <input id="license_identifier" v-model="form.license_identifier" type="text"
                placeholder="CC-BY-4.0" />
              <p class="hint">SPDX identifier (e.g. <code>CC-BY-4.0</code>) or custom name. Emits <code>podcast:license</code>.</p>
            </div>
            <div class="form-group flex-2">
              <label for="license_url">License URL</label>
              <input id="license_url" v-model="form.license_url" type="url"
                placeholder="https://creativecommons.org/licenses/by/4.0/" />
              <p class="hint">Link to license terms. Optional but recommended for non-SPDX identifiers.</p>
            </div>
          </div>

          <div class="form-group">
            <label for="verify_txt">Directory Verification Token</label>
            <input id="verify_txt" v-model="form.verify_txt" type="text"
              placeholder="apple-podcasts-connect:abc123 or spotify:xyz789" />
            <p class="hint">Free-form token published as <code>podcast:txt purpose="verify"</code>. Use when claiming the feed in Apple Podcasts Connect or Spotify for Podcasters.</p>
          </div>
        </div>

        <div class="form-section">
          <h2>Episode Numbering</h2>
          <p class="hint section-hint">
            Turn off whichever of these your podcast doesn't use. Disabled
            fields are hidden from the episode list and the episode editor.
            The "Overall #" column is always shown.
          </p>

          <div class="form-row">
            <div class="form-group">
              <label for="seasons_enabled">Use seasons</label>
              <select id="seasons_enabled" v-model="form.seasons_enabled">
                <option :value="true">Yes</option>
                <option :value="false">No</option>
              </select>
              <p class="hint">Shows the Season column on the episode list and the season selector on the editor.</p>
            </div>
            <div class="form-group">
              <label for="episode_numbers_enabled">Use episode numbers</label>
              <select id="episode_numbers_enabled" v-model="form.episode_numbers_enabled">
                <option :value="true">Yes</option>
                <option :value="false">No</option>
              </select>
              <p class="hint">Per-season (or per-show) episode #. Independent of seasons — many shows use only this.</p>
            </div>
          </div>
        </div>

        <div class="form-section">
          <h2>New Episode Templates</h2>
          <p class="hint section-hint">
            Pre-fills the title and show notes when you click "+ New Episode".
            Placeholders: <code>{season}</code>, <code>{episode}</code>, <code>{date}</code>
            (today as YYYY-MM-DD). Episode and season numbers are also
            auto-suggested from your most recent episode.
          </p>

          <div class="form-group">
            <label for="episode_title_template">Title template</label>
            <input id="episode_title_template" v-model="form.episode_title_template" type="text"
              placeholder="S{season}E{episode}: " />
            <p class="hint">Tip: leave a trailing space or punctuation so you can drop the new episode's title right after.</p>
          </div>

          <div class="form-group">
            <label for="episode_description_template">Show notes template</label>
            <RichTextEditor v-model="form.episode_description_template" :rows="10" />
            <p class="hint">Goes into the episode description editor on every new episode. Add your standard footer (links, credits, etc.) here once.</p>
          </div>
        </div>

        <div class="form-section">
          <h2>Publish Webhook</h2>
          <p class="hint section-hint">
            Notify a chat channel or other system when an episode goes live.
            Discord and Slack receive a richly-formatted message; <code>generic</code>
            posts a JSON body that any catcher (n8n, Zapier, custom) can consume.
          </p>

          <div class="form-row">
            <div class="form-group">
              <label for="webhook_format">Format</label>
              <select id="webhook_format" v-model="webhook.format">
                <option value="generic">Generic JSON</option>
                <option value="discord">Discord</option>
                <option value="slack">Slack</option>
              </select>
            </div>
            <div class="form-group">
              <label for="webhook_enabled">Status</label>
              <select id="webhook_enabled" v-model="webhook.enabled">
                <option :value="false">Disabled</option>
                <option :value="true">Enabled</option>
              </select>
              <p class="hint">When disabled, the URL is kept on file but no events fire.</p>
            </div>
          </div>

          <div class="form-group">
            <label for="webhook_url">Webhook URL</label>
            <input id="webhook_url" v-model="webhook.url" type="url"
              :placeholder="webhook.has_url ? `(set; host ${webhook.url_host || 'unknown'}) — leave blank to keep` : 'https://discord.com/api/webhooks/…'" />
            <p class="hint">
              <span v-if="webhook.has_url && !webhook.url">A URL is currently saved for {{ webhook.url_host || 'an unknown host' }}. Leave blank to keep it; type a new one to replace; clear and submit "" to remove.</span>
              <span v-else>Stored encrypted at rest. Discord webhook URLs include a token, so they're treated as a secret.</span>
            </p>
          </div>

          <div class="webhook-actions">
            <button type="button" class="btn-secondary" :disabled="webhookSaving || !webhook.has_url" @click="testWebhook">
              {{ webhookTesting ? 'Sending…' : 'Send test' }}
            </button>
            <button type="button" class="btn-secondary" :disabled="webhookSaving" @click="saveWebhook">
              {{ webhookSaving ? 'Saving…' : 'Save webhook' }}
            </button>
            <span v-if="webhookMsg" class="webhook-msg" :class="{ ok: webhookMsgOk, err: !webhookMsgOk }">
              {{ webhookMsg }}
            </span>
          </div>
        </div>

        <div v-if="me?.is_admin" class="form-section">
          <h2>Build Page Access</h2>
          <p class="hint section-hint">
            Who can view this podcast's Build page (GitHub config + manual
            rebuild). When set to admins-only, the link is hidden from member
            navigation and the underlying API endpoints 403. Only admins can
            change this setting.
          </p>

          <div class="form-group">
            <label for="build_admin_only">Build page</label>
            <select id="build_admin_only" v-model="form.build_admin_only">
              <option :value="true">Admins only (default)</option>
              <option :value="false">All podcast members</option>
            </select>
          </div>
        </div>

        <div class="form-section">
          <h2>Publishing Lifecycle</h2>
          <p class="hint section-hint">
            A Podshelf-only label for where this show stands. Surfaced via the
            API (so static-site builds can group / hide retired shows) and used
            to organize the dashboard. <strong>Not</strong> shown in the RSS feed.
          </p>

          <div class="form-group">
            <label for="lifecycle">Status</label>
            <select id="lifecycle" v-model="form.lifecycle">
              <option value="active">Active — currently publishing</option>
              <option value="inactive">Inactive — on hiatus, may return</option>
              <option value="retired">Retired — done, archive only</option>
            </select>
          </div>
        </div>

        <div class="form-actions">
          <span v-if="saving" class="save-status saving">Saving…</span>
          <span v-else-if="justSaved" class="save-status ok">✓ Saved</span>
          <span v-else-if="errorMsg" class="save-status err">✗ {{ errorMsg }}</span>
          <button type="submit" class="btn-primary" :disabled="saving">
            {{ saving ? 'Saving…' : 'Save Settings' }}
          </button>
        </div>
      </form>

      <div v-if="!pending" class="form-section danger-zone">
        <h2>Danger Zone</h2>
        <div v-if="initial?.status === 'inactive'" class="dz-row">
          <div>
            <strong>This podcast is awaiting purge.</strong>
            <p class="hint">The public RSS feed returns 404 while inactive. Restore it below to bring it back, or ask an admin to permanently delete it.</p>
          </div>
          <button type="button" class="btn-restore" :disabled="restoring" @click="restorePodcast">
            {{ restoring ? 'Restoring…' : 'Restore' }}
          </button>
        </div>
        <div v-else class="dz-row">
          <div>
            <strong>Delete podcast</strong>
            <p class="hint">Soft-deletes this podcast. The RSS feed becomes unavailable; episodes are preserved. Any podcast member can restore from the dashboard, or an admin can permanently purge it.</p>
          </div>
          <button type="button" class="btn-danger" :disabled="deleting" @click="confirmDelete">
            {{ deleting ? 'Deleting…' : 'Delete podcast' }}
          </button>
        </div>
      </div>
    </div>

    <ArtworkPicker
      :open="pickerOpen"
      :podcast-slug="podcastSlug"
      @close="pickerOpen = false"
      @select="onArtworkPicked"
    />

    <div v-if="showDeleteConfirm" class="modal-overlay" @click.self="showDeleteConfirm = false">
      <div class="modal">
        <h3>Delete this podcast?</h3>
        <p>
          <strong>{{ form.title }}</strong> will be marked inactive. The public RSS
          feed will return 404 immediately. Episodes are preserved and you can
          restore the podcast from the dashboard until an admin purges it.
        </p>
        <div class="modal-actions">
          <button class="btn-secondary" @click="showDeleteConfirm = false">Cancel</button>
          <button class="btn-danger" :disabled="deleting" @click="doDelete">
            {{ deleting ? 'Deleting…' : 'Soft-delete' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const podcastSlug = route.params.slug as string

interface PodcastRow {
  slug: string
  title: string
  description: string | null
  author: string | null
  email: string | null
  image_url: string | null
  language: string | null
  copyright: string | null
  category: string | null
  explicit: string | null
  website: string | null
  audio_tracking_prefix: string | null
  itunes_type: string | null
  podcast_locked: string | null
  itunes_complete: string | null
  itunes_block: string | null
  funding_url: string | null
  funding_label: string | null
  verify_txt: string | null
  license_identifier: string | null
  license_url: string | null
  episode_title_template: string | null
  episode_description_template: string | null
  seasons_enabled: number | null
  episode_numbers_enabled: number | null
  status: string
  lifecycle: string | null
  build_admin_only: number | null
  deleted_at: string | null
}
interface Me { id: number; email: string; is_admin: boolean }

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const { data: initial, pending } = await useFetch<PodcastRow>(`/api/podcasts/${podcastSlug}`)
const { data: me } = await useFetch<Me>('/api/me')

const form = reactive({
  slug: podcastSlug,
  title: '',
  description: '',
  author: '',
  email: '',
  image_url: '',
  language: 'en',
  copyright: '',
  category: 'Society & Culture',
  explicit: 'false',
  website: '',
  audio_tracking_prefix: '',
  itunes_type: 'episodic',
  podcast_locked: 'no',
  itunes_complete: 'no',
  itunes_block: 'no',
  funding_url: '',
  funding_label: '',
  verify_txt: '',
  license_identifier: '',
  license_url: '',
  episode_title_template: '',
  episode_description_template: '',
  seasons_enabled: true,
  episode_numbers_enabled: true,
  lifecycle: 'active',
  build_admin_only: true,
})

const originalSlug = ref(podcastSlug)
const slugChanged = computed(() => form.slug.trim() !== originalSlug.value)
const slugValid = computed(() => SLUG_RE.test(form.slug.trim()))

const saving = ref(false)
const justSaved = ref(false)
const successMsg = ref('')
const errorMsg = ref('')

const { uploading: artworkUploading, uploadProgress, uploadFile } = useUpload(podcastSlug)
const artworkError = ref('')

interface SlugAlias {
  id: number
  old_slug: string
  created_at: string
}

const aliases = ref<SlugAlias[]>([])
async function loadAliases() {
  try {
    aliases.value = await $fetch<SlugAlias[]>(`/api/podcasts/${podcastSlug}/aliases`)
  } catch {
    aliases.value = []
  }
}
await loadAliases()

function formatAliasDate(iso: string): string {
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z')
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

interface WebhookDescription {
  has_url: boolean
  format: 'discord' | 'slack' | 'generic'
  enabled: boolean
  url_host: string | null
}

const webhook = reactive({
  url: '',
  format: 'generic' as 'discord' | 'slack' | 'generic',
  enabled: false,
  has_url: false,
  url_host: null as string | null,
})
const webhookSaving = ref(false)
const webhookTesting = ref(false)
const webhookMsg = ref('')
const webhookMsgOk = ref(false)

async function loadWebhook() {
  try {
    const data = await $fetch<WebhookDescription>(`/api/podcasts/${podcastSlug}/webhook`)
    webhook.format = data.format
    webhook.enabled = data.enabled
    webhook.has_url = data.has_url
    webhook.url_host = data.url_host
    webhook.url = ''
  } catch {
    // best-effort — leave defaults
  }
}
await loadWebhook()

async function saveWebhook() {
  webhookSaving.value = true
  webhookMsg.value = ''
  try {
    const body: Record<string, unknown> = {
      format: webhook.format,
      enabled: webhook.enabled,
    }
    // Only include url if the user typed something. Empty string is
    // intentional clear; undefined preserves the existing value.
    if (webhook.url !== '') body.url = webhook.url
    await $fetch(`/api/podcasts/${podcastSlug}/webhook`, { method: 'POST', body })
    webhookMsg.value = 'Webhook saved.'
    webhookMsgOk.value = true
    await loadWebhook()
  } catch (err: unknown) {
    webhookMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
      || (err instanceof Error ? err.message : 'Save failed')
    webhookMsgOk.value = false
  } finally {
    webhookSaving.value = false
    setTimeout(() => { webhookMsg.value = '' }, 4000)
  }
}

async function testWebhook() {
  webhookTesting.value = true
  webhookMsg.value = ''
  try {
    await $fetch(`/api/podcasts/${podcastSlug}/webhook/test`, { method: 'POST' })
    webhookMsg.value = 'Test webhook delivered.'
    webhookMsgOk.value = true
  } catch (err: unknown) {
    webhookMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
      || (err instanceof Error ? err.message : 'Test failed')
    webhookMsgOk.value = false
  } finally {
    webhookTesting.value = false
    setTimeout(() => { webhookMsg.value = '' }, 6000)
  }
}

async function handleArtworkChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  artworkError.value = ''
  try {
    const result = await uploadFile(file, 'artwork')
    form.image_url = result.url
  } catch (err: unknown) {
    artworkError.value = err instanceof Error ? err.message : 'Artwork upload failed'
  } finally {
    input.value = ''
  }
}

const showDeleteConfirm = ref(false)
const deleting = ref(false)
const restoring = ref(false)

function confirmDelete() {
  showDeleteConfirm.value = true
}

async function doDelete() {
  deleting.value = true
  try {
    await $fetch(`/api/podcasts/${podcastSlug}`, { method: 'DELETE' })
    showDeleteConfirm.value = false
    await navigateTo('/')
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Failed to delete'
  } finally {
    deleting.value = false
  }
}

async function restorePodcast() {
  restoring.value = true
  try {
    await $fetch(`/api/podcasts/${podcastSlug}/restore`, { method: 'POST' })
    successMsg.value = 'Podcast restored.'
    if (initial.value) initial.value.status = 'active'
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Failed to restore'
  } finally {
    restoring.value = false
  }
}

const pickerOpen = ref(false)
function onArtworkPicked(payload: { url: string; name: string }) {
  form.image_url = payload.url
}

watch(initial, (p) => {
  if (!p) return
  form.slug = p.slug || podcastSlug
  originalSlug.value = p.slug || podcastSlug
  form.title = p.title || ''
  form.description = p.description || ''
  form.author = p.author || ''
  form.email = p.email || ''
  form.image_url = p.image_url || ''
  form.language = p.language || 'en'
  form.copyright = p.copyright || ''
  form.category = p.category || 'Society & Culture'
  form.explicit = p.explicit || 'false'
  form.website = p.website || ''
  form.audio_tracking_prefix = p.audio_tracking_prefix || ''
  form.itunes_type = p.itunes_type || 'episodic'
  form.podcast_locked = p.podcast_locked || 'no'
  form.itunes_complete = p.itunes_complete || 'no'
  form.itunes_block = p.itunes_block || 'no'
  form.funding_url = p.funding_url || ''
  form.funding_label = p.funding_label || ''
  form.verify_txt = p.verify_txt || ''
  form.license_identifier = p.license_identifier || ''
  form.license_url = p.license_url || ''
  form.episode_title_template = p.episode_title_template || ''
  form.episode_description_template = p.episode_description_template || ''
  form.seasons_enabled = p.seasons_enabled == null ? true : !!p.seasons_enabled
  form.episode_numbers_enabled = p.episode_numbers_enabled == null ? true : !!p.episode_numbers_enabled
  form.lifecycle = p.lifecycle || 'active'
  form.build_admin_only = p.build_admin_only == null ? true : !!p.build_admin_only
}, { immediate: true })

async function saveSettings() {
  errorMsg.value = ''
  successMsg.value = ''

  const trimmedSlug = form.slug.trim()
  if (!slugValid.value) {
    errorMsg.value = 'Slug must be lowercase letters, digits, and hyphens (no leading/trailing hyphen).'
    return
  }

  if (slugChanged.value) {
    const ok = window.confirm(
      `Change slug from "${originalSlug.value}" to "${trimmedSlug}"?\n\n` +
      `The old feed URL (/feeds/${originalSlug.value}.xml) keeps working — it now emits ` +
      'an <itunes:new-feed-url> tag so modern podcast apps auto-migrate subscribers ' +
      'to the new URL. Admin/dashboard bookmarks under the old slug WILL 404 and need updating.\n\n' +
      'Note: the old slug is permanently reserved to this podcast and can never be reused.'
    )
    if (!ok) return
  }

  saving.value = true
  try {
    const body: Record<string, unknown> = { ...form, slug: trimmedSlug }
    // Non-admins can't change build_admin_only; drop it from the body
    // rather than letting the API 403 the whole save.
    if (!me.value?.is_admin) delete body.build_admin_only
    await $fetch(`/api/podcasts/${podcastSlug}`, {
      method: 'PATCH',
      body,
    })
    if (slugChanged.value) {
      await navigateTo(`/podcasts/${trimmedSlug}/settings`)
      return
    }
    successMsg.value = 'Settings saved successfully.'
    justSaved.value = true
    setTimeout(() => { justSaved.value = false }, 3500)
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
      || (err instanceof Error ? err.message : 'Failed to save settings')
  } finally {
    saving.value = false
  }
}

useHead({ title: 'Settings — Podshelf Admin' })
</script>

<style scoped>
* { box-sizing: border-box; }

.admin-page {
  min-height: 100vh;
  background: #f7fafc;
  font-family: system-ui, sans-serif;
}

.container {
  max-width: 760px;
  margin: 0 auto;
  padding: 2rem 1.25rem;
}

h1 {
  margin: 0 0 1.5rem;
  font-size: 1.5rem;
  color: #1a202c;
}

.settings-form {
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

label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: #4a5568;
  margin-bottom: 0.375rem;
}
.required { color: #e53e3e; }
.hint { font-size: 0.78rem; color: #718096; margin-top: 0.375rem; }
.hint code {
  background: #edf2f7;
  padding: 0.1em 0.35em;
  border-radius: 3px;
  font-size: 0.85em;
}

input[type="text"],
input[type="url"],
input[type="email"],
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

.input-with-action {
  display: flex;
  gap: 0.5rem;
}
.input-with-action input { flex: 1; }
.btn-upload {
  display: inline-flex;
  align-items: center;
  padding: 0.5rem 0.875rem;
  background: #edf2f7;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 500;
  color: #4a5568;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}
.btn-upload:hover { background: #e2e8f0; border-color: #cbd5e0; }

.artwork-preview {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 0.75rem;
  background: #f7fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  margin-bottom: 0.5rem;
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
  word-break: break-all;
}
.artwork-meta a { color: #667eea; }
.btn-secondary.btn-clear-artwork {
  flex-shrink: 0;
  padding: 0.4rem 0.75rem;
  font-size: 0.8rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  cursor: pointer;
  color: #4a5568;
}
.btn-secondary.btn-clear-artwork:hover { background: #f7fafc; }
.probe-error {
  padding: 0.5rem 0.75rem;
  background: #fff5f5;
  color: #c53030;
  border-radius: 6px;
  font-size: 0.8rem;
  margin-top: 0.5rem;
}
.input-invalid {
  border-color: #fc8181 !important;
}
.slug-warning {
  margin-top: 0.5rem;
  padding: 0.625rem 0.75rem;
  background: #fffaf0;
  border: 1px solid #fbd38d;
  color: #744210;
  border-radius: 6px;
  font-size: 0.8rem;
  line-height: 1.5;
}
.slug-warning code {
  background: rgba(0, 0, 0, 0.06);
  padding: 0.05em 0.3em;
  border-radius: 3px;
  font-size: 0.9em;
}

.alias-list {
  list-style: none;
  margin: 0 0 0.5rem;
  padding: 0;
}
.alias-list li {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.4rem 0.625rem;
  background: #f7fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  margin-bottom: 0.25rem;
  font-size: 0.85rem;
}
.alias-list code {
  background: white;
  padding: 0.15em 0.4em;
  border-radius: 4px;
  border: 1px solid #e2e8f0;
}
.alias-meta {
  color: #718096;
  font-size: 0.78rem;
  margin-left: auto;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 0.75rem;
  padding-bottom: 2rem;
}

.save-status {
  font-size: 0.875rem;
  font-weight: 500;
}
.save-status.saving { color: #718096; }
.save-status.ok { color: #2f855a; }
.save-status.err { color: #c53030; max-width: 380px; }

.btn-primary {
  padding: 0.6rem 1.5rem;
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
button:disabled { opacity: 0.6; cursor: not-allowed; }

.danger-zone {
  border-color: #fed7d7;
  background: #fffaf0;
}
.danger-zone h2 { color: #c53030; }
.dz-row {
  display: flex;
  gap: 1.25rem;
  align-items: center;
  justify-content: space-between;
}
.dz-row > div { flex: 1; }
.dz-row strong { color: #2d3748; font-size: 0.95rem; }
.btn-danger {
  flex-shrink: 0;
  padding: 0.55rem 1.1rem;
  background: #e53e3e;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-danger:hover:not(:disabled) { background: #c53030; }

.btn-restore {
  flex-shrink: 0;
  padding: 0.55rem 1.1rem;
  background: #ebf4ff;
  border: 1px solid #c3dafe;
  color: #4c51bf;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
}
.btn-restore:hover:not(:disabled) { background: #c3dafe; }

.btn-secondary {
  padding: 0.5rem 1rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.875rem;
  cursor: pointer;
  color: #4a5568;
  transition: all 0.15s;
}
.btn-secondary:hover { background: #f7fafc; }

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
  max-width: 480px;
  width: 90%;
}
.modal h3 { margin: 0 0 0.75rem; font-size: 1.1rem; }
.modal p { color: #4a5568; font-size: 0.9rem; margin: 0 0 1.5rem; }
.modal-actions { display: flex; gap: 0.75rem; justify-content: flex-end; }

@media (max-width: 720px) {
  .container { padding: 1rem 0.75rem; }
  .form-section { padding: 1rem; }
  /* 16px input font prevents iOS Safari from zooming on focus. */
  input[type="text"],
  input[type="url"],
  input[type="email"],
  select,
  textarea {
    font-size: 16px;
    padding: 0.625rem 0.75rem;
    min-height: 44px;
  }
  textarea { min-height: auto; }
  .form-actions .btn-primary { min-height: 44px; }
  .input-with-action {
    flex-wrap: wrap;
  }
  .input-with-action input { min-width: 0; flex: 1 1 100%; }
  .input-with-action .btn-upload { flex: 1; justify-content: center; }
  .artwork-preview {
    flex-wrap: wrap;
  }
  .artwork-meta { flex-basis: 100%; order: 3; }
  .dz-row {
    flex-direction: column;
    align-items: stretch;
    gap: 0.875rem;
  }
  .dz-row .btn-danger,
  .dz-row .btn-restore {
    align-self: stretch;
  }
  .modal {
    padding: 1.25rem;
    max-height: 86vh;
    overflow-y: auto;
  }
  .modal-actions { flex-direction: column-reverse; }
  .modal-actions button { width: 100%; }
}

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
  margin: -0.75rem 0 1rem;
  font-size: 0.82rem;
  color: #4a5568;
}
.section-hint code {
  background: #edf2f7;
  padding: 0.1em 0.35em;
  border-radius: 3px;
  font-size: 0.85em;
}

.webhook-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
  flex-wrap: wrap;
}
.webhook-actions .btn-secondary {
  padding: 0.45rem 0.875rem;
  font-size: 0.85rem;
  background: #edf2f7;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  cursor: pointer;
  color: #4a5568;
}
.webhook-actions .btn-secondary:hover:not(:disabled) {
  background: #e2e8f0;
}
.webhook-msg {
  font-size: 0.82rem;
  padding: 0.3rem 0.6rem;
  border-radius: 5px;
}
.webhook-msg.ok {
  background: #f0fff4;
  border: 1px solid #9ae6b4;
  color: #276749;
}
.webhook-msg.err {
  background: #fff5f5;
  border: 1px solid #fc8181;
  color: #c53030;
}

@media (max-width: 600px) {
  .form-row { flex-direction: column; }
}
</style>
