<template>
  <section class="schedule-panel">
    <h2>Calendar feed</h2>
    <p class="hint">
      Subscribe in Apple Calendar / Google Calendar / Outlook to see this
      {{ scopeType === 'network' ? 'network\'s' : 'show\'s' }} recording
      sessions and publish dates. Google polls subscriptions about once a
      day, so last-minute changes can take a while to land — recording-time
      changes also fire the publish webhook if you've configured one.
    </p>

    <div v-if="pending" class="loading">Loading…</div>

    <div v-else>
      <ul v-if="activeTokens.length" class="token-list">
        <li v-for="t in activeTokens" :key="t.id" class="token-row">
          <div class="token-meta">
            <strong>{{ t.label || 'Unlabelled subscription' }}</strong>
            <span class="token-date">Created {{ formatDate(t.created_at) }}</span>
          </div>
          <div class="token-urls">
            <code class="url">{{ webcalUrlFor(t.token) }}</code>
            <div class="token-actions">
              <button type="button" class="btn-mini" @click="copy(httpsUrlFor(t.token))">
                {{ copiedToken === t.token ? '✓ Copied' : 'Copy link' }}
              </button>
              <a class="btn-mini" :href="googleAddUrl(t.token)" target="_blank" rel="noopener">
                Add to Google
              </a>
              <a class="btn-mini" :href="webcalUrlFor(t.token)">
                Add to Apple
              </a>
              <button type="button" class="btn-mini btn-danger" @click="revoke(t.id)">
                Revoke
              </button>
            </div>
          </div>
        </li>
      </ul>
      <p v-else class="empty">No subscriptions yet.</p>

      <div class="mint-row">
        <input
          v-model="newLabel"
          type="text"
          placeholder="Label (e.g. iPhone, work laptop)"
          maxlength="100"
          @keydown.enter.prevent="mint"
        />
        <button type="button" class="btn-primary" :disabled="minting" @click="mint">
          {{ minting ? 'Generating…' : 'Generate subscribe link' }}
        </button>
      </div>
      <p v-if="errorMsg" class="error">{{ errorMsg }}</p>

      <details v-if="revokedTokens.length" class="revoked-fold">
        <summary>{{ revokedTokens.length }} revoked</summary>
        <ul class="token-list muted">
          <li v-for="t in revokedTokens" :key="t.id" class="token-row">
            <div class="token-meta">
              <strong>{{ t.label || 'Unlabelled subscription' }}</strong>
              <span class="token-date">Revoked {{ formatDate(t.revoked_at || '') }}</span>
            </div>
          </li>
        </ul>
      </details>
    </div>
  </section>
</template>

<script setup lang="ts">
interface ScheduleToken {
  id: number
  token: string
  scope_type: 'podcast' | 'network'
  scope_id: number
  scope_slug: string | null
  label: string | null
  created_at: string
  revoked_at: string | null
}

const props = defineProps<{
  scopeType: 'podcast' | 'network'
  scopeSlug: string
}>()

const tokens = ref<ScheduleToken[]>([])
const pending = ref(true)
const minting = ref(false)
const errorMsg = ref('')
const newLabel = ref('')
const copiedToken = ref<string | null>(null)

const siteUrl = computed(() => {
  // Prefer the runtime-configured public origin so emitted links match
  // what listeners actually use; fall back to whatever the page was
  // served from. Calendar apps tolerate either http:// or https:// in
  // the webcal: rewrite below, but Google's `cid=` add-URL only honors
  // https origins.
  const cfgUrl = (useRuntimeConfig().public.siteUrl as string | undefined) || ''
  if (cfgUrl) return cfgUrl.replace(/\/+$/, '')
  if (typeof window !== 'undefined') return window.location.origin
  return ''
})

// Filter to this panel's scope so a token list shared across the page
// shows only what's relevant where it's mounted.
const relevantTokens = computed(() =>
  tokens.value.filter((t) =>
    t.scope_type === props.scopeType && t.scope_slug === props.scopeSlug),
)
const activeTokens = computed(() => relevantTokens.value.filter((t) => !t.revoked_at))
const revokedTokens = computed(() => relevantTokens.value.filter((t) => t.revoked_at))

function httpsUrlFor(token: string): string {
  return `${siteUrl.value}/schedule/${token}.ics`
}
function webcalUrlFor(token: string): string {
  return httpsUrlFor(token).replace(/^https?:/, 'webcal:')
}
function googleAddUrl(token: string): string {
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(httpsUrlFor(token))}`
}

async function refresh() {
  pending.value = true
  try {
    tokens.value = await $fetch<ScheduleToken[]>('/api/schedule-tokens')
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : 'Failed to load subscriptions'
  } finally {
    pending.value = false
  }
}

async function mint() {
  errorMsg.value = ''
  minting.value = true
  try {
    await $fetch('/api/schedule-tokens', {
      method: 'POST',
      body: {
        scope_type: props.scopeType,
        scope_slug: props.scopeSlug,
        label: newLabel.value.trim() || null,
      },
    })
    newLabel.value = ''
    await refresh()
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
      || (err instanceof Error ? err.message : 'Failed to generate link')
  } finally {
    minting.value = false
  }
}

async function revoke(id: number) {
  if (!window.confirm('Revoke this subscription? Calendar apps will drop it on their next refresh.')) return
  try {
    await $fetch(`/api/schedule-tokens/${id}`, { method: 'DELETE' })
    await refresh()
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
      || (err instanceof Error ? err.message : 'Failed to revoke')
  }
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copiedToken.value = text.match(/\/schedule\/([^.]+)\.ics$/)?.[1] || null
    setTimeout(() => { copiedToken.value = null }, 1800)
  } catch {
    // Clipboard API can fail on insecure origins / Safari focus rules;
    // surface a generic message rather than silently doing nothing.
    errorMsg.value = 'Copy failed — select the URL manually.'
  }
}

function formatDate(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

onMounted(refresh)
</script>

<style scoped>
.schedule-panel {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 1.25rem 1.5rem;
  margin-top: 1.25rem;
}
.schedule-panel h2 {
  margin: 0 0 0.5rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: #718096;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.hint { font-size: 0.85rem; color: #4a5568; margin: 0 0 1rem; }
.loading, .empty {
  color: #a0aec0;
  font-size: 0.9rem;
  padding: 0.75rem 0;
  margin: 0;
}
.token-list { list-style: none; margin: 0 0 1rem; padding: 0; display: flex; flex-direction: column; gap: 0.6rem; }
.token-list.muted { opacity: 0.7; margin-top: 0.6rem; }
.token-row {
  border: 1px solid #edf2f7;
  border-radius: 8px;
  padding: 0.65rem 0.85rem;
}
.token-meta { display: flex; gap: 0.6rem; align-items: baseline; margin-bottom: 0.4rem; flex-wrap: wrap; }
.token-meta strong { font-size: 0.95rem; color: #1a202c; }
.token-date { font-size: 0.78rem; color: #a0aec0; }
.token-urls { display: flex; flex-direction: column; gap: 0.4rem; }
.url {
  font-family: ui-monospace, monospace;
  font-size: 0.78rem;
  color: #4a5568;
  background: #f7fafc;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  word-break: break-all;
}
.token-actions { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.btn-mini {
  font-size: 0.78rem;
  padding: 0.3rem 0.6rem;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: white;
  color: #4a5568;
  text-decoration: none;
  cursor: pointer;
  font-family: inherit;
}
.btn-mini:hover { border-color: #667eea; color: #4c51bf; }
.btn-mini.btn-danger { color: #c53030; }
.btn-mini.btn-danger:hover { border-color: #c53030; }

.mint-row {
  display: flex;
  gap: 0.5rem;
  align-items: stretch;
  margin-top: 0.5rem;
}
.mint-row input {
  flex: 1;
  padding: 0.45rem 0.6rem;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font: inherit;
  color: #2d3748;
}
.btn-primary {
  padding: 0.45rem 0.9rem;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
}
.btn-primary:hover { background: #5a67d8; }
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

.error { color: #c53030; font-size: 0.85rem; margin: 0.5rem 0 0; }

.revoked-fold {
  margin-top: 0.75rem;
  font-size: 0.85rem;
  color: #718096;
}
.revoked-fold summary { cursor: pointer; }
</style>
