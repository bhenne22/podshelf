<template>
  <div class="admin-page">
    <AdminNav :podcast-slug="podcastSlug" />
    <div class="container">
      <div class="page-header">
        <h1>{{ podcast?.title || 'Dashboard' }}</h1>
        <NuxtLink :to="`/podcasts/${podcastSlug}/episodes/new`" class="btn-primary">+ New Episode</NuxtLink>
      </div>

      <div v-if="pending" class="loading">Loading…</div>

      <template v-else-if="data">
        <div class="cards">
          <NuxtLink :to="`/podcasts/${podcastSlug}/episodes`" class="card">
            <div class="card-value">{{ data.counts.total }}</div>
            <div class="card-label">Episodes</div>
          </NuxtLink>
          <NuxtLink :to="`/podcasts/${podcastSlug}/episodes?status=published`" class="card card-published">
            <div class="card-value">{{ data.counts.published }}</div>
            <div class="card-label">Published</div>
          </NuxtLink>
          <NuxtLink :to="`/podcasts/${podcastSlug}/episodes?status=draft`" class="card card-draft">
            <div class="card-value">{{ data.counts.drafts }}</div>
            <div class="card-label">Drafts</div>
          </NuxtLink>
        </div>

        <div class="cards">
          <NuxtLink :to="`/podcasts/${podcastSlug}/stats`" class="card">
            <div class="card-value">{{ data.downloads.total.toLocaleString() }}</div>
            <div class="card-label">Total Downloads</div>
          </NuxtLink>
          <NuxtLink :to="`/podcasts/${podcastSlug}/stats`" class="card">
            <div class="card-value">{{ data.downloads.last_30d.toLocaleString() }}</div>
            <div class="card-label">Last 30 days</div>
          </NuxtLink>
          <NuxtLink :to="`/podcasts/${podcastSlug}/stats`" class="card">
            <div class="card-value">{{ data.downloads.last_7d.toLocaleString() }}</div>
            <div class="card-label">Last 7 days</div>
          </NuxtLink>
        </div>

        <div class="row">
          <section class="panel">
            <h2>Latest Published</h2>
            <div v-if="data.latest_published" class="recent">
              <NuxtLink :to="`/podcasts/${podcastSlug}/episodes/${data.latest_published.id}`" class="recent-title">
                <span v-if="data.latest_published.episode_number" class="ep-num">
                  <template v-if="data.latest_published.season_number">S{{ data.latest_published.season_number }}E{{ data.latest_published.episode_number }}</template>
                  <template v-else>#{{ data.latest_published.episode_number }}</template>
                </span>
                {{ data.latest_published.title }}
              </NuxtLink>
              <div class="recent-meta">{{ formatDate(data.latest_published.published_at) }}</div>
            </div>
            <p v-else class="empty-line">Nothing published yet.</p>
          </section>

          <section class="panel">
            <h2>Newest Draft</h2>
            <div v-if="data.newest_draft" class="recent">
              <NuxtLink :to="`/podcasts/${podcastSlug}/episodes/${data.newest_draft.id}`" class="recent-title">
                <span v-if="data.newest_draft.episode_number" class="ep-num">
                  <template v-if="data.newest_draft.season_number">S{{ data.newest_draft.season_number }}E{{ data.newest_draft.episode_number }}</template>
                  <template v-else>#{{ data.newest_draft.episode_number }}</template>
                </span>
                {{ data.newest_draft.title }}
              </NuxtLink>
              <div class="recent-meta">created {{ formatDate(data.newest_draft.created_at) }}</div>
            </div>
            <p v-else class="empty-line">No open drafts.</p>
          </section>
        </div>

        <section class="panel">
          <h2>Quick Links</h2>
          <div class="quick-links">
            <NuxtLink :to="`/podcasts/${podcastSlug}/episodes/new`" class="quick">+ New episode</NuxtLink>
            <NuxtLink :to="`/podcasts/${podcastSlug}/settings`" class="quick">Show settings</NuxtLink>
            <NuxtLink :to="`/podcasts/${podcastSlug}/storage`" class="quick">Storage</NuxtLink>
            <NuxtLink :to="`/podcasts/${podcastSlug}/build`" class="quick">Build &amp; deploy</NuxtLink>
            <NuxtLink :to="`/podcasts/${podcastSlug}/members`" class="quick">Members</NuxtLink>
            <a :href="`/feeds/${podcastSlug}.xml`" target="_blank" rel="noopener" class="quick">RSS feed ↗</a>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const podcastSlug = route.params.slug as string

interface Podcast { title: string }
interface DashboardData {
  counts: { total: number; published: number; drafts: number }
  latest_published: { id: number; title: string; slug: string; episode_number: number | null; season_number: number | null; published_at: string } | null
  newest_draft: { id: number; title: string; slug: string; episode_number: number | null; season_number: number | null; created_at: string } | null
  downloads: { total: number; last_30d: number; last_7d: number }
}

const { data: podcast } = await useFetch<Podcast>(`/api/podcasts/${podcastSlug}`)
const { data, pending } = await useFetch<DashboardData>(`/api/podcasts/${podcastSlug}/dashboard`)

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

useHead({ title: () => podcast.value ? `${podcast.value.title} — Podshelf Admin` : 'Podshelf Admin' })
</script>

<style scoped>
* { box-sizing: border-box; }
.admin-page { min-height: 100vh; background: #f7fafc; font-family: system-ui, sans-serif; }
.container { max-width: 960px; margin: 0 auto; padding: 2rem 1.25rem; }

.page-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 1.5rem;
}
h1 { margin: 0; font-size: 1.5rem; color: #1a202c; }

.btn-primary {
  display: inline-block;
  padding: 0.5rem 1rem;
  background: #667eea; color: white;
  border: none; border-radius: 6px;
  font-size: 0.875rem; font-weight: 500;
  text-decoration: none;
}
.btn-primary:hover { background: #5a67d8; }

.loading { padding: 2rem; text-align: center; color: #718096; }

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.card {
  display: block;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 1.25rem 1.5rem;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.15s, transform 0.15s;
}
.card:hover { border-color: #667eea; transform: translateY(-1px); }

.card-value {
  font-size: 1.875rem;
  font-weight: 700;
  color: #1a202c;
  line-height: 1;
  margin-bottom: 0.5rem;
}
.card-label {
  font-size: 0.78rem;
  color: #718096;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.card-published .card-value { color: #2f855a; }
.card-draft .card-value { color: #b7791f; }

.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  margin-top: 1.25rem;
}
@media (max-width: 700px) { .row { grid-template-columns: 1fr; } }

.panel {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 1.25rem 1.5rem;
}
.panel h2 {
  margin: 0 0 0.75rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: #718096;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.recent { display: flex; flex-direction: column; gap: 0.25rem; }
.recent-title {
  color: #2d3748;
  font-weight: 500;
  text-decoration: none;
  font-size: 0.95rem;
}
.recent-title:hover { color: #667eea; text-decoration: underline; }
.ep-num {
  display: inline-block;
  padding: 0.1rem 0.45rem;
  background: #edf2f7;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  color: #4a5568;
  margin-right: 0.4rem;
  font-family: ui-monospace, monospace;
}
.recent-meta { font-size: 0.78rem; color: #a0aec0; }
.empty-line { color: #a0aec0; font-size: 0.9rem; margin: 0; }

.quick-links {
  margin-top: 1.25rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.quick {
  padding: 0.4rem 0.8rem;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  text-decoration: none;
  color: #4a5568;
  font-size: 0.85rem;
  transition: all 0.15s;
}
.quick:hover { border-color: #667eea; color: #4c51bf; background: #ebf4ff; }
</style>
