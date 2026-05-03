<template>
  <div class="admin-page">
    <AdminNav :podcast-slug="podcastSlug" />
    <div class="container">
      <div class="page-header">
        <h1>Import from RSS</h1>
        <NuxtLink :to="`/podcasts/${podcastSlug}/episodes`" class="btn-back">← Back to Episodes</NuxtLink>
      </div>

      <p class="intro">
        Pulls every episode from an existing podcast RSS feed and creates draft-free
        published records here. Audio URLs from the feed are kept as-is — you can
        SFTP the audio files to your new host afterward and update the URLs (or
        leave them pointed at the old host).
      </p>
      <p class="intro warn">
        This is a one-shot operation. It's only available while this podcast has
        no episodes.
      </p>

      <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

      <div v-if="result" class="success-msg">
        <p><strong>Imported {{ result.imported }} episodes</strong> from <em>{{ result.feed_title }}</em>.</p>
        <p v-if="result.skipped">Skipped {{ result.skipped }} item(s) that had no audio enclosure.</p>
        <p>Heading to the episodes list…</p>
      </div>

      <form v-if="!result" @submit.prevent="onSubmit" class="form-section">
        <div class="form-group">
          <label for="feed_url">Feed URL</label>
          <input
            id="feed_url"
            v-model="feedUrl"
            type="url"
            placeholder="https://feeds.example.com/yourpodcast.xml"
            required
            autofocus
          />
        </div>

        <div class="form-actions">
          <NuxtLink :to="`/podcasts/${podcastSlug}/episodes`" class="btn-secondary">Cancel</NuxtLink>
          <button type="submit" class="btn-primary" :disabled="loading">
            {{ loading ? 'Importing…' : 'Import' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const router = useRouter()
const podcastSlug = route.params.slug as string

const feedUrl = ref('')
const loading = ref(false)
const errorMsg = ref('')

interface ImportResult {
  feed_title: string | null
  total_items: number
  imported: number
  skipped: number
}
const result = ref<ImportResult | null>(null)

async function onSubmit() {
  loading.value = true
  errorMsg.value = ''
  try {
    result.value = await $fetch<ImportResult>(`/api/podcasts/${podcastSlug}/import-rss`, {
      method: 'POST',
      body: { feed_url: feedUrl.value },
    })
    setTimeout(() => router.push(`/podcasts/${podcastSlug}/episodes`), 1500)
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Import failed'
  } finally {
    loading.value = false
  }
}

useHead({ title: 'Import RSS — Podshelf Admin' })
</script>

<style scoped>
* { box-sizing: border-box; }
.admin-page { min-height: 100vh; background: #f7fafc; font-family: system-ui, sans-serif; }
.container { max-width: 720px; margin: 0 auto; padding: 2rem 1.25rem; }

.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
h1 { margin: 0; font-size: 1.5rem; color: #1a202c; }
.btn-back { font-size: 0.875rem; color: #667eea; text-decoration: none; }
.btn-back:hover { text-decoration: underline; }

.intro {
  color: #4a5568;
  font-size: 0.95rem;
  line-height: 1.55;
  margin: 0 0 0.75rem;
}
.intro.warn { color: #b7791f; }

.form-section {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 1.5rem;
}

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

.form-actions { display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1.5rem; }
.btn-primary {
  padding: 0.6rem 1.25rem;
  background: #667eea; color: white;
  border: none; border-radius: 6px;
  font-size: 0.9rem; font-weight: 500;
  cursor: pointer; text-decoration: none;
}
.btn-primary:hover:not(:disabled) { background: #5a67d8; }
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

.btn-secondary {
  padding: 0.6rem 1.25rem;
  background: white; color: #4a5568;
  border: 1px solid #e2e8f0; border-radius: 6px;
  font-size: 0.9rem; cursor: pointer; text-decoration: none;
}
.btn-secondary:hover { background: #f7fafc; }

.error-msg {
  background: #fff5f5; border: 1px solid #fc8181;
  color: #c53030; padding: 0.875rem 1rem;
  border-radius: 8px; margin-bottom: 1rem; font-size: 0.9rem;
}

.success-msg {
  background: #f0fff4; border: 1px solid #9ae6b4;
  color: #276749; padding: 1rem 1.25rem;
  border-radius: 10px; margin-bottom: 1rem;
  line-height: 1.55;
}
.success-msg p { margin: 0.25rem 0; }
.success-msg em { font-style: italic; }
</style>
