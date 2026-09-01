<template>
  <div v-if="status?.pending?.last_at" class="pending-banner" :class="{ off: !status.auto_trigger }">
    <div class="pending-info">
      <div class="pending-title">
        <span class="pending-dot" />
        Pending changes — {{ podcastTitle }}
      </div>
      <div class="pending-detail">
        <template v-if="status.auto_trigger && status.configured">
          Auto-publishes <strong>{{ countdownLabel }}</strong>
          ({{ formatTime(status.pending.scheduled_for) }}) — last edit {{ relative(status.pending.last_at) }}.
        </template>
        <template v-else-if="!status.configured">
          GitHub isn't configured for this podcast yet — an admin needs to set it up under Build.
        </template>
        <template v-else>
          Auto-publish is off. Click <strong>Rebuild Now</strong> to publish these changes.
        </template>
      </div>
    </div>
    <button
      type="button"
      class="pending-btn"
      :disabled="triggering || !status.configured"
      @click="rebuildNow"
    >
      {{ triggering ? 'Triggering…' : 'Rebuild Now' }}
    </button>
    <span v-if="errorMsg" class="pending-error">{{ errorMsg }}</span>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  podcastSlug: string
  podcastTitle?: string
}>()

interface PublishStatus {
  configured: boolean
  auto_trigger: boolean
  pending: {
    first_at: string | null
    last_at: string | null
    scheduled_for: string | null
    debounce_minutes: number
  }
}

const status = ref<PublishStatus | null>(null)
const triggering = ref(false)
const errorMsg = ref('')

// Declared up here rather than beside tickHandle because the top-level
// `await load()` below runs before those declarations initialise — reaching
// for pollHandle from inside load() would hit the TDZ on that first call.
let pollHandle: ReturnType<typeof setInterval> | null = null
function stopPolling() {
  if (pollHandle) { clearInterval(pollHandle); pollHandle = null }
}

async function load() {
  try {
    status.value = await $fetch<PublishStatus>(`/api/podcasts/${props.podcastSlug}/publish-status`)
  } catch (err: unknown) {
    status.value = null
    // An expired session used to leave this polling a 401 every 30s forever,
    // behind a page that still looked logged in. Same rule as
    // middleware/auth.ts: only an explicit 401 means "not authenticated";
    // transient errors are ignored so a blip doesn't bounce a logged-in user.
    const e = err as { statusCode?: number; response?: { status?: number } }
    if ((e?.statusCode ?? e?.response?.status) === 401) {
      stopPolling()
      await navigateTo('/login')
    }
  }
}

async function rebuildNow() {
  triggering.value = true
  errorMsg.value = ''
  try {
    await $fetch(`/api/podcasts/${props.podcastSlug}/github/trigger`, { method: 'POST' })
    await load()
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Trigger failed'
    setTimeout(() => { errorMsg.value = '' }, 5000)
  } finally {
    triggering.value = false
  }
}

await load()

// Tick every second so the countdown stays live.
const now = ref(Date.now())
let tickHandle: ReturnType<typeof setInterval> | null = null

const hasPending = computed(() => !!status.value?.pending?.last_at)
function startTick() {
  if (tickHandle) return
  tickHandle = setInterval(() => { now.value = Date.now() }, 1000)
}
function stopTick() {
  if (tickHandle) { clearInterval(tickHandle); tickHandle = null }
}
watch(hasPending, (yes) => { yes ? startTick() : stopTick() }, { immediate: true })

onMounted(() => {
  // Poll less often than the tick — server state changes only when someone
  // saves an episode or the scheduler fires. 30s is a fine cadence.
  pollHandle = setInterval(() => { void load() }, 30_000)
})
onBeforeUnmount(() => {
  stopTick()
  stopPolling()
})

// Refetch when the slug changes (e.g., user navigates between podcasts).
watch(() => props.podcastSlug, () => { void load() })

const countdownLabel = computed(() => {
  const target = status.value?.pending?.scheduled_for
  if (!target) return ''
  const ms = new Date(target).getTime() - now.value
  if (ms <= 0) return 'any moment now'
  const totalSec = Math.floor(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  if (min === 0) return `in ${sec}s`
  return `in ${min}m ${String(sec).padStart(2, '0')}s`
})

function formatTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function relative(iso: string | null): string {
  if (!iso) return ''
  const ms = now.value - new Date(iso).getTime()
  if (ms < 0) return 'just now'
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  return `${hr} hr ago`
}
</script>

<style scoped>
.pending-banner {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.625rem 1.25rem;
  background: #fffaf0;
  border-bottom: 1px solid #f6ad55;
  font-family: system-ui, sans-serif;
}
.pending-banner.off {
  background: #fef5e7;
  border-bottom-color: #ed8936;
}
.pending-info { flex: 1; min-width: 0; }
.pending-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  font-size: 0.9rem;
  color: #7b341e;
  margin-bottom: 0.15rem;
}
.pending-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ed8936;
  box-shadow: 0 0 0 4px rgba(237, 137, 54, 0.18);
  animation: pending-pulse 2s ease-in-out infinite;
  flex-shrink: 0;
}
@keyframes pending-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.55; }
}
.pending-detail {
  font-size: 0.82rem;
  color: #744210;
  line-height: 1.45;
}

.pending-btn {
  flex-shrink: 0;
  padding: 0.5rem 1rem;
  background: #38a169;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
}
.pending-btn:hover:not(:disabled) { background: #2f855a; }
.pending-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.pending-error {
  font-size: 0.78rem;
  color: #c53030;
  background: #fff5f5;
  border: 1px solid #fc8181;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

@media (max-width: 720px) {
  .pending-banner {
    flex-direction: column;
    align-items: stretch;
    gap: 0.625rem;
    padding: 0.75rem 1rem;
  }
  .pending-btn { min-height: 44px; }
}
</style>
