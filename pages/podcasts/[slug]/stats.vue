<template>
  <div class="admin-page">
    <AdminNav :podcast-slug="podcastSlug" />
    <div class="container">
      <h1>Download Analytics</h1>

      <div v-if="pending" class="loading">Loading stats…</div>
      <div v-else-if="error" class="error-msg">Failed to load stats.</div>
      <template v-else-if="stats">

        <!-- Summary cards -->
        <div class="cards">
          <div class="card">
            <div class="card-value">{{ stats.total.toLocaleString() }}</div>
            <div class="card-label">Total Downloads</div>
          </div>
          <div class="card">
            <div class="card-value">{{ stats.last30Days.toLocaleString() }}</div>
            <div class="card-label">Last 30 Days</div>
          </div>
          <div class="card">
            <div class="card-value">{{ stats.last7Days.toLocaleString() }}</div>
            <div class="card-label">Last 7 Days</div>
          </div>
        </div>

        <!-- Daily chart -->
        <div class="section" v-if="stats.byDay.length">
          <h2>Downloads — Last 30 Days</h2>
          <div class="chart">
            <div
              v-for="day in filledDays"
              :key="day.date"
              class="chart-col"
              :title="`${day.date}: ${day.count}`"
            >
              <div class="bar-wrap">
                <div
                  class="bar"
                  :style="{ height: maxDay > 0 ? (day.count / maxDay * 100) + '%' : '0%' }"
                ></div>
              </div>
              <div class="bar-label">{{ formatDayLabel(day.date) }}</div>
            </div>
          </div>
        </div>

        <!-- By episode -->
        <div class="section" v-if="stats.byEpisode.length">
          <h2>By Episode</h2>
          <table class="data-table">
            <thead>
              <tr>
                <th>Episode</th>
                <th class="num">Last 30d</th>
                <th class="num">All Time</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="ep in stats.byEpisode" :key="ep.id">
                <td>
                  <NuxtLink :to="`/podcasts/${podcastSlug}/episodes/${ep.id}`" class="ep-link">
                    <span v-if="ep.season_number && ep.episode_number" class="ep-num">
                      S{{ ep.season_number }}E{{ ep.episode_number }}
                    </span>
                    {{ decodeEntities(ep.title) }}
                  </NuxtLink>
                </td>
                <td class="num">{{ ep.last30Days.toLocaleString() }}</td>
                <td class="num">{{ ep.total.toLocaleString() }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- By country -->
        <div class="section" v-if="stats.byCountry.length">
          <h2>By Country</h2>
          <table class="data-table">
            <thead>
              <tr>
                <th>Country</th>
                <th class="num">Downloads</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in stats.byCountry" :key="row.country">
                <td>{{ row.country }}</td>
                <td class="num">{{ row.count.toLocaleString() }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="!stats.total" class="empty">
          No downloads recorded yet. Point your RSS feed's audio tracking prefix at
          <code>{{ siteUrl }}/track/</code> to start capturing data.
        </div>

      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const podcastSlug = route.params.slug as string

interface StatRow { date: string; count: number }
interface EpisodeRow { id: number; title: string; slug: string; episode_number: number | null; season_number: number | null; total: number; last30Days: number }
interface CountryRow { country: string; count: number }
interface Stats {
  total: number
  last30Days: number
  last7Days: number
  byDay: StatRow[]
  byEpisode: EpisodeRow[]
  byCountry: CountryRow[]
}

const { data: stats, pending, error } = await useFetch<Stats>(`/api/podcasts/${podcastSlug}/stats`, { lazy: true })
const config = useRuntimeConfig()
const siteUrl = config.public.siteUrl || 'http://localhost:3000'

const maxDay = computed(() => {
  if (!stats.value?.byDay.length) return 0
  return Math.max(...stats.value.byDay.map((d) => d.count))
})

// Fill in missing days in the last 30 days so the chart has no gaps
const filledDays = computed(() => {
  if (!stats.value) return []
  const map = new Map(stats.value.byDay.map((d) => [d.date, d.count]))
  const days: StatRow[] = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    days.push({ date: key, count: map.get(key) || 0 })
  }
  return days
})

function formatDayLabel(date: string): string {
  const d = new Date(date + 'T00:00:00')
  return d.getDate() === 1 || d.getDay() === 0 ? String(d.getDate()) : ''
}

function decodeEntities(str: string): string {
  return str
    .replace(/&#8211;/g, '–')
    .replace(/&#038;/g, '&')
    .replace(/&#8217;/g, '\u2019')
    .replace(/&amp;/g, '&')
}

useHead({ title: 'Analytics — Podshelf Admin' })
</script>

<style scoped>
.admin-page { min-height: 100vh; background: #f7fafc; font-family: system-ui, sans-serif; }
.container { max-width: 900px; margin: 0 auto; padding: 2rem 1.25rem; }
h1 { margin: 0 0 1.5rem; font-size: 1.5rem; color: #1a202c; }

.cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.card {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 1.25rem 1.5rem;
  text-align: center;
}
.card-value { font-size: 2rem; font-weight: 700; color: #667eea; }
.card-label { font-size: 0.8rem; color: #718096; margin-top: 0.25rem; text-transform: uppercase; letter-spacing: 0.05em; }

.section {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 1.25rem 1.5rem;
  margin-bottom: 1.25rem;
}
.section h2 {
  margin: 0 0 1rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: #4a5568;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Chart */
.chart {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 120px;
  padding-bottom: 20px;
  position: relative;
}
.chart-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
}
.bar-wrap {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
}
.bar {
  width: 100%;
  background: #667eea;
  border-radius: 2px 2px 0 0;
  min-height: 1px;
  transition: background 0.15s;
}
.chart-col:hover .bar { background: #5a67d8; }
.bar-label {
  font-size: 0.65rem;
  color: #a0aec0;
  text-align: center;
  height: 18px;
  line-height: 18px;
}

/* Table */
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}
.data-table th {
  text-align: left;
  padding: 0.5rem 0.75rem;
  border-bottom: 2px solid #e2e8f0;
  font-size: 0.75rem;
  font-weight: 600;
  color: #718096;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.data-table td {
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid #f7fafc;
  color: #2d3748;
}
.data-table tr:last-child td { border-bottom: none; }
.data-table tr:hover td { background: #f7fafc; }
.num { text-align: right; }
.ep-num { font-size: 0.75rem; color: #a0aec0; margin-right: 0.4rem; }
.ep-link { color: #2d3748; text-decoration: none; }
.ep-link:hover { color: #667eea; }

.empty { text-align: center; color: #718096; padding: 3rem 1rem; font-size: 0.9rem; }
.empty code { background: #edf2f7; padding: 0.1em 0.4em; border-radius: 3px; font-size: 0.85em; }
.loading { color: #718096; padding: 2rem 0; }
.error-msg { background: #fff5f5; border: 1px solid #fc8181; color: #c53030; padding: 0.875rem 1rem; border-radius: 8px; }

@media (max-width: 600px) {
  .cards { grid-template-columns: 1fr; }
}
</style>
