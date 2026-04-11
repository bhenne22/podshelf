<template>
  <div class="admin-page">
    <AdminNav />
    <div class="container">
      <h1>Show Settings</h1>

      <div v-if="successMsg" class="success-msg">{{ successMsg }}</div>
      <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

      <div v-if="pending" class="loading">Loading settings…</div>

      <form v-else @submit.prevent="saveSettings" class="settings-form">
        <div class="form-section">
          <h2>Podcast Identity</h2>

          <div class="form-group">
            <label for="show_title">Show Title <span class="required">*</span></label>
            <input id="show_title" v-model="form.show_title" type="text" required placeholder="My Awesome Podcast" />
          </div>

          <div class="form-group">
            <label for="show_description">Description</label>
            <textarea id="show_description" v-model="form.show_description" rows="4"
              placeholder="A brief description of your show for podcast directories and your RSS feed."
            ></textarea>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="show_author">Author / Host Name</label>
              <input id="show_author" v-model="form.show_author" type="text" placeholder="Jane Doe" />
            </div>
            <div class="form-group">
              <label for="show_email">Contact Email</label>
              <input id="show_email" v-model="form.show_email" type="email" placeholder="podcast@example.com" />
              <p class="hint">Used in iTunes owner email field of the RSS feed.</p>
            </div>
          </div>

          <div class="form-group">
            <label for="show_image_url">Podcast Artwork URL</label>
            <input id="show_image_url" v-model="form.show_image_url" type="url"
              placeholder="https://example.com/podcast-art.jpg" />
            <p class="hint">Must be at least 1400×1400px per Apple Podcasts requirements.</p>
          </div>

          <div class="form-group">
            <label for="show_website">Show Website</label>
            <input id="show_website" v-model="form.show_website" type="url"
              placeholder="https://yourpodcast.example.com" />
          </div>
        </div>

        <div class="form-section">
          <h2>RSS / Directory Settings</h2>

          <div class="form-row">
            <div class="form-group">
              <label for="show_language">Language</label>
              <input id="show_language" v-model="form.show_language" type="text" placeholder="en" />
              <p class="hint">ISO 639-1 code, e.g. en, es, fr</p>
            </div>
            <div class="form-group">
              <label for="show_category">iTunes Category</label>
              <select id="show_category" v-model="form.show_category">
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
              <label for="show_explicit">Explicit Content</label>
              <select id="show_explicit" v-model="form.show_explicit">
                <option value="false">No (Clean)</option>
                <option value="true">Yes (Explicit)</option>
              </select>
            </div>
            <div class="form-group">
              <label for="show_copyright">Copyright</label>
              <input id="show_copyright" v-model="form.show_copyright" type="text"
                placeholder="© 2025 Jane Doe" />
            </div>
          </div>

          <div class="form-group">
            <label for="audio_tracking_prefix">Audio Tracking Prefix</label>
            <input id="audio_tracking_prefix" v-model="form.audio_tracking_prefix" type="text"
              placeholder="https://media.blubrry.com/1467354/" />
            <p class="hint">Prepended to episode audio URLs in the RSS feed only (e.g. Blubrry, Chartable, Podtrac). To use Podshelf's built-in tracking, set this to <code>{{ siteUrl }}/track/</code>.</p>
          </div>
        </div>

        <div class="form-section">
          <h2>Analytics</h2>

          <div class="form-group">
            <label for="geoip_db_path">GeoIP Database Path</label>
            <input id="geoip_db_path" v-model="form.geoip_db_path" type="text"
              placeholder="/path/to/GeoLite2-City.mmdb" />
            <p class="hint">
              Optional. Path to a MaxMind GeoLite2-City <code>.mmdb</code> file on this server.
              Enables country/region/city breakdown in download analytics.
              Download free from <a href="https://dev.maxmind.com/geoip/geolite2-free-geolocation-data" target="_blank" rel="noopener">maxmind.com</a> (free account required).
            </p>
          </div>
        </div>

        <div class="form-section">
          <h2>Storage Adapter</h2>
          <p class="section-desc">
            Storage settings are configured via environment variables in your <code>.env</code> file.
            See <a href="/docs/storage.md" target="_blank">storage documentation</a> for details.
          </p>
          <div class="env-info">
            <div class="env-row">
              <span class="env-key">STORAGE_ADAPTER</span>
              <span class="env-value">{{ storageAdapter }}</span>
            </div>
          </div>
        </div>

        <div class="form-actions">
          <button type="submit" class="btn-primary" :disabled="saving">
            {{ saving ? 'Saving…' : 'Save Settings' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'admin-auth' })

const { data: initialSettings, pending } = await useFetch<Record<string, string>>('/api/settings')
const config = useRuntimeConfig()

const storageAdapter = config.storageAdapter || 'sftp'
const siteUrl = config.public.siteUrl || 'http://localhost:3000'

const form = reactive({
  show_title: '',
  show_description: '',
  show_author: '',
  show_email: '',
  show_image_url: '',
  show_language: 'en',
  show_copyright: '',
  show_category: 'Society & Culture',
  show_explicit: 'false',
  show_website: '',
  audio_tracking_prefix: '',
  geoip_db_path: '',
})

const saving = ref(false)
const successMsg = ref('')
const errorMsg = ref('')

watch(initialSettings, (settings) => {
  if (settings) {
    Object.assign(form, settings)
  }
}, { immediate: true })

async function saveSettings() {
  saving.value = true
  errorMsg.value = ''
  successMsg.value = ''

  try {
    await $fetch('/api/settings', {
      method: 'POST',
      body: { ...form },
    })
    successMsg.value = 'Settings saved successfully.'
  } catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : 'Failed to save settings'
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

.section-desc {
  font-size: 0.875rem;
  color: #718096;
  margin: 0 0 1rem;
}
.section-desc a { color: #667eea; }
.section-desc code {
  background: #edf2f7;
  padding: 0.1em 0.35em;
  border-radius: 3px;
  font-size: 0.85em;
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

.env-info {
  background: #f7fafc;
  border-radius: 6px;
  padding: 0.75rem 1rem;
  font-size: 0.875rem;
}
.env-row {
  display: flex;
  gap: 1rem;
  align-items: center;
}
.env-key {
  font-family: monospace;
  color: #4a5568;
  min-width: 180px;
}
.env-value {
  font-family: monospace;
  color: #667eea;
  font-weight: 600;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  padding-bottom: 2rem;
}

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

@media (max-width: 600px) {
  .form-row { flex-direction: column; }
}
</style>
