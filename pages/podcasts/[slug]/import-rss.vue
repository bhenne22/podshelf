<template>
  <div class="admin-page">
    <AdminNav :podcast-slug="podcastSlug" />
    <div class="container">
      <div class="page-header">
        <h1>Import / Export</h1>
        <NuxtLink :to="`/podcasts/${podcastSlug}/episodes`" class="btn-back">← Back to Episodes</NuxtLink>
      </div>

      <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>
      <div v-if="successMsg" class="success-msg" v-html="successMsg"></div>

      <!-- Export -->
      <section class="form-section">
        <h2>Export Podshelf archive</h2>
        <p class="section-intro">
          Downloads a JSON archive containing this podcast's settings,
          episodes (all statuses including drafts and scheduled), people
          roster, and slug aliases. Excludes secrets (storage / GitHub /
          webhook URLs) — re-configure those on the receiving instance.
          Importable into another Podshelf install via the section below.
        </p>
        <a :href="`/api/podcasts/${podcastSlug}/export.json`" download class="btn-primary inline-link">
          Download {{ podcastSlug }}.podshelf.json
        </a>
      </section>

      <!-- Import from Podshelf archive -->
      <section class="form-section">
        <h2>Import Podshelf archive</h2>
        <p class="section-intro">
          Restore a podcast exported from another Podshelf instance. Empty-
          podcast only — same constraint as the RSS importer.
        </p>
        <p class="section-intro warn" v-if="!isEmpty">
          This podcast already has episodes; clear them before importing.
        </p>

        <div class="form-group" v-if="isEmpty">
          <label for="archive_file">Archive file</label>
          <input
            id="archive_file"
            ref="archiveFileInput"
            type="file"
            accept="application/json,.json"
            class="file-input"
          />
        </div>

        <div class="form-actions" v-if="isEmpty">
          <button type="button" class="btn-primary" :disabled="jsonLoading" @click="onJsonImport">
            {{ jsonLoading ? 'Importing…' : 'Import archive' }}
          </button>
        </div>
      </section>

      <!-- Import from external RSS (legacy / migration from another host) -->
      <section class="form-section">
        <h2>Import from RSS feed</h2>
        <p class="section-intro">
          Pulls every episode from an existing podcast RSS feed and creates
          published records here. Audio URLs are preserved as-is — copy the
          files to your new host afterward and use the storage migration
          tool to rewrite URLs.
        </p>
        <p class="section-intro warn" v-if="!isEmpty">
          This podcast already has episodes; clear them before importing.
        </p>

        <form v-if="isEmpty" @submit.prevent="onRssImport">
          <div class="form-group">
            <label for="feed_url">Feed URL</label>
            <input
              id="feed_url"
              v-model="feedUrl"
              type="url"
              placeholder="https://feeds.example.com/yourpodcast.xml"
              required
            />
          </div>
          <div class="form-actions">
            <button type="submit" class="btn-primary" :disabled="rssLoading">
              {{ rssLoading ? 'Importing…' : 'Import' }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const router = useRouter()
const podcastSlug = route.params.slug as string

const feedUrl = ref('')
const rssLoading = ref(false)
const jsonLoading = ref(false)
const errorMsg = ref('')
const successMsg = ref('')
const archiveFileInput = ref<HTMLInputElement | null>(null)

interface EpisodeRow { id: number }
const existingEpisodes = await $fetch<EpisodeRow[]>(`/api/podcasts/${podcastSlug}/episodes`)
const isEmpty = ref(existingEpisodes.length === 0)

interface RssImportResult {
  feed_title: string | null
  total_items: number
  imported: number
  skipped: number
}

interface JsonImportResult {
  imported: {
    episodes: number
    people: number
    episode_people: number
    slug_aliases: number
  }
  settings_backfilled: string[]
}

async function onRssImport() {
  rssLoading.value = true
  errorMsg.value = ''
  successMsg.value = ''
  try {
    const result = await $fetch<RssImportResult>(`/api/podcasts/${podcastSlug}/import-rss`, {
      method: 'POST',
      body: { feed_url: feedUrl.value },
    })
    successMsg.value = `Imported <strong>${result.imported} episodes</strong> from <em>${result.feed_title ?? 'feed'}</em>.`
        + (result.skipped ? ` Skipped ${result.skipped} item(s) without audio.` : '')
        + ' Heading to the episodes list…'
    setTimeout(() => router.push(`/podcasts/${podcastSlug}/episodes`), 1500)
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Import failed'
  } finally {
    rssLoading.value = false
  }
}

async function onJsonImport() {
  errorMsg.value = ''
  successMsg.value = ''
  const file = archiveFileInput.value?.files?.[0]
  if (!file) {
    errorMsg.value = 'Pick an archive file first.'
    return
  }
  jsonLoading.value = true
  try {
    const text = await file.text()
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      throw new Error('That file is not valid JSON.')
    }
    const result = await $fetch<JsonImportResult>(`/api/podcasts/${podcastSlug}/import-json`, {
      method: 'POST',
      body: body as Record<string, unknown>,
    })
    successMsg.value = `Imported <strong>${result.imported.episodes} episodes</strong>, `
        + `${result.imported.people} people, `
        + `${result.imported.episode_people} attachments`
        + (result.imported.slug_aliases ? `, ${result.imported.slug_aliases} slug aliases` : '')
        + '. Heading to the episodes list…'
    setTimeout(() => router.push(`/podcasts/${podcastSlug}/episodes`), 1500)
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
        || (err instanceof Error ? err.message : 'Import failed')
  } finally {
    jsonLoading.value = false
  }
}

useHead({ title: 'Import / Export — Podshelf Admin' })
</script>

<style scoped>
* { box-sizing: border-box; }
.admin-page { min-height: 100vh; background: #f7fafc; font-family: system-ui, sans-serif; }
.container { max-width: 720px; margin: 0 auto; padding: 2rem 1.25rem; }

.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
h1 { margin: 0; font-size: 1.5rem; color: #1a202c; }
.btn-back { font-size: 0.875rem; color: #667eea; text-decoration: none; }
.btn-back:hover { text-decoration: underline; }

.form-section {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 1.5rem;
  margin-bottom: 1.25rem;
}
.form-section h2 {
  margin: 0 0 0.75rem;
  font-size: 0.95rem;
  font-weight: 600;
  color: #4a5568;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.section-intro {
  color: #4a5568;
  font-size: 0.9rem;
  line-height: 1.55;
  margin: 0 0 0.875rem;
}
.section-intro.warn { color: #b7791f; }

.form-group { margin-bottom: 1rem; }
label { display: block; font-size: 0.875rem; font-weight: 500; color: #4a5568; margin-bottom: 0.375rem; }

input[type="url"] {
  display: block; width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid #e2e8f0; border-radius: 6px;
  font-size: 0.9rem;
  background: white; outline: none;
}
input[type="url"]:focus {
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102,126,234,0.15);
}
.file-input {
  display: block;
  padding: 0.375rem;
  background: #f7fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  width: 100%;
  font-size: 0.875rem;
}

.form-actions { display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem; }
.btn-primary {
  padding: 0.55rem 1.1rem;
  background: #667eea; color: white;
  border: none; border-radius: 6px;
  font-size: 0.9rem; font-weight: 500;
  cursor: pointer; text-decoration: none;
}
.btn-primary:hover:not(:disabled) { background: #5a67d8; }
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-primary.inline-link { display: inline-block; }

.error-msg {
  background: #fff5f5; border: 1px solid #fc8181;
  color: #c53030; padding: 0.875rem 1rem;
  border-radius: 8px; margin-bottom: 1rem; font-size: 0.9rem;
}

.success-msg {
  background: #f0fff4; border: 1px solid #9ae6b4;
  color: #276749; padding: 0.875rem 1rem;
  border-radius: 8px; margin-bottom: 1rem; font-size: 0.9rem;
  line-height: 1.55;
}
:deep(.success-msg em) { font-style: italic; }

@media (max-width: 720px) {
  .container { padding: 1rem 0.75rem; }
  .form-section { padding: 1rem; }
}
</style>
