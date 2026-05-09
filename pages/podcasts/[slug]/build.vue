<template>
  <div class="admin-page">
    <AdminNav :podcast-slug="podcastSlug" />
    <div class="container">
      <h1>Build &amp; Deploy</h1>
      <p class="hint">
        When this podcast's feed changes, Podshelf can automatically tell GitHub to
        rebuild your static site by firing a <code>repository_dispatch</code> event.
        Your GitHub Actions workflow listens for the event and deploys the new
        feed. The PAT is encrypted with your <code>PODSHELF_ENCRYPTION_KEY</code>.
      </p>

      <div v-if="successMsg" class="success-msg">{{ successMsg }}</div>
      <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

      <div v-if="hasPending" class="pending-banner" :class="{ off: !current?.auto_trigger }">
        <div class="pending-info">
          <div class="pending-title">
            <span class="pending-dot" />
            Pending changes
          </div>
          <div class="pending-detail">
            <template v-if="current?.auto_trigger && current?.configured">
              Auto-publishes <strong>{{ countdownLabel }}</strong> ({{ formatTime(current.pending.scheduled_for) }})
              — first edit at {{ formatTime(current.pending.first_at) }}, last {{ relative(current.pending.last_at) }}.
            </template>
            <template v-else-if="!current?.configured">
              GitHub isn't fully configured yet — fill in the form below and click
              <strong>Rebuild Now</strong> to publish, or save and the timer will resume.
            </template>
            <template v-else>
              Auto-publish is off. Click <strong>Rebuild Now</strong> to publish these changes,
              or turn auto-publish on below.
            </template>
          </div>
        </div>
        <button
          type="button"
          class="btn-rebuild pending-btn"
          :disabled="triggering || !current?.configured"
          @click="manualTrigger"
        >
          {{ triggering ? 'Triggering…' : 'Rebuild Now' }}
        </button>
      </div>

      <p v-else-if="current?.configured" class="status">
        <strong>Configured.</strong> Auto-publish is
        <strong>{{ form.auto_trigger ? `on (${PUBLISH_DEBOUNCE_MINUTES}-min debounce)` : 'off' }}</strong>.
        No pending changes.
      </p>

      <form @submit.prevent="save" class="form-section">
        <h2>GitHub Repository</h2>

        <div class="form-row">
          <div class="form-group">
            <label>Owner</label>
            <input v-model="form.owner" type="text" placeholder="bhenne22" required />
            <p class="hint">GitHub username or org that owns the repo.</p>
          </div>
          <div class="form-group flex-2">
            <label>Repository</label>
            <input v-model="form.repo" type="text" placeholder="yousaid100miles.com" required />
          </div>
        </div>

        <div class="form-group">
          <label>Event Type</label>
          <input v-model="form.event_type" type="text" placeholder="podshelf-feed-update" required />
          <p class="hint">
            The <code>event_type</code> string Podshelf will send. Match this in your
            workflow with <code>on: { repository_dispatch: { types: [&lt;event_type&gt;] } }</code>.
          </p>
        </div>

        <div class="form-group">
          <label>Personal Access Token</label>
          <input v-model="form.token" type="password" autocomplete="off"
            :placeholder="current?.has_token ? '(leave blank to keep existing)' : 'ghp_… or fine-grained token'" />
          <p class="hint">
            Fine-grained token: <code>Contents</code> → <strong>Read and write</strong> on the target repo
            (the <code>repository_dispatch</code> endpoint checks contents-write, not
            actions-write). Classic token: <code>repo</code> scope. Stored encrypted.
          </p>
        </div>

        <div class="form-group">
          <label class="checkbox">
            <input v-model="form.auto_trigger" type="checkbox" />
            Auto-publish after a {{ PUBLISH_DEBOUNCE_MINUTES }}-minute quiet period
          </label>
          <p class="hint">
            Off by default — flip on once you've verified manual rebuild works. See
            "How auto-publish works" below for the full picture.
          </p>
        </div>

        <div class="form-actions">
          <span v-if="saving" class="save-status saving">Saving…</span>
          <span v-else-if="justSaved" class="save-status ok">✓ Saved</span>
          <span v-else-if="errorMsg" class="save-status err">✗ {{ errorMsg }}</span>
          <button type="button" class="btn-secondary" :disabled="testing || !canTest" @click="testTrigger">
            {{ testing ? 'Testing…' : 'Test Dispatch' }}
          </button>
          <button type="submit" class="btn-primary" :disabled="saving">
            {{ saving ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </form>

      <div class="form-section">
        <h2>Manual Rebuild</h2>
        <p class="hint">
          Fires a <code>repository_dispatch</code> right now using the saved
          configuration. Use this to deploy without changing anything in the feed.
          Also clears any pending-changes window if there is one.
        </p>
        <div class="form-actions form-actions-row">
          <span v-if="triggering" class="save-status saving">Triggering…</span>
          <span v-else-if="lastTriggerOk" class="save-status ok">✓ Sent ({{ lastTriggerOk }})</span>
          <button class="btn-rebuild" :disabled="triggering || !current?.configured" @click="manualTrigger">
            {{ triggering ? 'Triggering…' : 'Rebuild Now' }}
          </button>
        </div>
      </div>

      <div class="form-section explainer">
        <h2>How auto-publish works</h2>
        <ol class="explainer-list">
          <li>
            <strong>Any feed-visible change marks this podcast "dirty"</strong> — saving an
            episode, deleting a published episode, editing podcast settings, RSS/JSON
            import, attaching people, etc.
          </li>
          <li>
            <strong>Each new change resets a {{ PUBLISH_DEBOUNCE_MINUTES }}-minute timer.</strong>
            Edit, save, edit again, save — the clock keeps starting over until you stop.
          </li>
          <li>
            <strong>Once it's been quiet for {{ PUBLISH_DEBOUNCE_MINUTES }} minutes, Podshelf fires
            one <code>repository_dispatch</code></strong> to your GitHub Actions workflow. So 10
            saves in 5 minutes still equals one build, not ten.
          </li>
          <li>
            <strong>Don't want to wait?</strong> The pending-changes banner at the top of
            this page shows a <em>Rebuild Now</em> button — that fires immediately and
            clears the timer.
          </li>
          <li>
            <strong>Auto-publish off?</strong> Pending changes still accumulate (so you can see
            "5 edits since 2:13 PM") but never fire automatically. You'll need to click
            <em>Rebuild Now</em> here, or flip auto-publish back on.
          </li>
        </ol>
        <p class="hint explainer-foot">
          The check runs in-process every 60 seconds. If the Podshelf service restarts,
          the dirty markers are persisted — the next tick after restart picks them back up.
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const podcastSlug = route.params.slug as string

interface PublishPending {
  first_at: string | null
  last_at: string | null
  scheduled_for: string | null
  debounce_minutes: number
}

interface GitHubDescription {
  configured: boolean
  owner: string | null
  repo: string | null
  event_type: string | null
  has_token: boolean
  auto_trigger: boolean
  pending: PublishPending
}

// Hardcoded fallback so the template can render before the first fetch
// completes; the server returns the actual value via pending.debounce_minutes.
const PUBLISH_DEBOUNCE_MINUTES = 15

interface MeRow { id: number; email: string; is_admin: boolean }
interface PodcastBuildRow { build_admin_only: number | null }

// Bounce non-admins away when this podcast restricts the Build page to admins.
const [{ data: meData }, { data: podcastRow }] = await Promise.all([
  useFetch<MeRow>('/api/me'),
  useFetch<PodcastBuildRow>(`/api/podcasts/${podcastSlug}`),
])
if (
  meData.value && !meData.value.is_admin
  && podcastRow.value?.build_admin_only
) {
  await navigateTo(`/podcasts/${podcastSlug}/episodes`)
}

const { data: current, refresh } = await useFetch<GitHubDescription>(`/api/podcasts/${podcastSlug}/github`)

const form = reactive({
  owner: '',
  repo: '',
  event_type: '',
  token: '',
  auto_trigger: false,
})

watch(current, (c) => {
  if (!c) return
  form.owner = c.owner || ''
  form.repo = c.repo || ''
  form.event_type = c.event_type || ''
  form.auto_trigger = c.auto_trigger
}, { immediate: true })

const saving = ref(false)
const justSaved = ref(false)
const successMsg = ref('')
const errorMsg = ref('')

const testing = ref(false)
const triggering = ref(false)
const lastTriggerOk = ref('')

const canTest = computed(() =>
  !!form.owner && !!form.repo && !!form.event_type && (!!form.token || !!current.value?.has_token),
)

const hasPending = computed(() => !!current.value?.pending?.last_at)

// Re-render the countdown each second so "in 12 min 34 sec" stays live.
// Tick only runs while there's something pending.
const now = ref(Date.now())
let tickHandle: ReturnType<typeof setInterval> | null = null
function startTick() {
  if (tickHandle) return
  tickHandle = setInterval(() => { now.value = Date.now() }, 1000)
}
function stopTick() {
  if (tickHandle) { clearInterval(tickHandle); tickHandle = null }
}
watch(hasPending, (yes) => { if (yes) startTick(); else stopTick() }, { immediate: true })
onBeforeUnmount(stopTick)

// Periodically re-fetch the github config so the banner stays fresh if the
// scheduler fired in the background (or if another tab edited things).
let refreshHandle: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  refreshHandle = setInterval(() => { void refresh() }, 30_000)
})
onBeforeUnmount(() => {
  if (refreshHandle) clearInterval(refreshHandle)
})

const countdownLabel = computed(() => {
  const target = current.value?.pending?.scheduled_for
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

async function save() {
  saving.value = true
  successMsg.value = ''
  errorMsg.value = ''
  try {
    await $fetch(`/api/podcasts/${podcastSlug}/github`, {
      method: 'POST',
      body: { ...form },
    })
    successMsg.value = 'GitHub configuration saved.'
    justSaved.value = true
    setTimeout(() => { justSaved.value = false }, 3500)
    form.token = ''
    await refresh()
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Failed to save'
  } finally {
    saving.value = false
  }
}

async function testTrigger() {
  testing.value = true
  successMsg.value = ''
  errorMsg.value = ''
  try {
    const result = await $fetch<{ status: number }>(`/api/podcasts/${podcastSlug}/github/test`, {
      method: 'POST',
      body: { ...form },
    })
    successMsg.value = `Test dispatch sent (HTTP ${result.status}). Check your repo's Actions tab.`
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Test failed'
  } finally {
    testing.value = false
  }
}

async function manualTrigger() {
  triggering.value = true
  successMsg.value = ''
  errorMsg.value = ''
  lastTriggerOk.value = ''
  try {
    const result = await $fetch<{ status: number }>(`/api/podcasts/${podcastSlug}/github/trigger`, {
      method: 'POST',
    })
    successMsg.value = `Rebuild dispatch sent (HTTP ${result.status}).`
    lastTriggerOk.value = `HTTP ${result.status}`
    setTimeout(() => { lastTriggerOk.value = '' }, 4000)
    await refresh()
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage || 'Trigger failed'
  } finally {
    triggering.value = false
  }
}

useHead({ title: 'Build — Podshelf Admin' })
</script>

<style scoped>
* { box-sizing: border-box; }
.admin-page { min-height: 100vh; background: #f7fafc; font-family: system-ui, sans-serif; }
.container { max-width: 760px; margin: 0 auto; padding: 2rem 1.25rem; }

h1 { margin: 0 0 0.5rem; font-size: 1.5rem; color: #1a202c; }
.hint {
  font-size: 0.85rem; color: #718096;
  margin-bottom: 1.5rem; line-height: 1.55;
}
.hint code {
  background: #edf2f7;
  padding: 0.1em 0.35em;
  border-radius: 3px;
  font-family: ui-monospace, monospace;
  font-size: 0.85em;
  color: #4a5568;
}

.status {
  font-size: 0.85rem;
  color: #2f855a;
  background: #f0fff4;
  border: 1px solid #9ae6b4;
  padding: 0.6rem 0.9rem;
  border-radius: 6px;
  margin-bottom: 1.25rem;
}

.pending-banner {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.875rem 1rem;
  background: #fffaf0;
  border: 1px solid #f6ad55;
  border-radius: 8px;
  margin-bottom: 1.25rem;
}
.pending-banner.off {
  background: #fef5e7;
  border-color: #ed8936;
}
.pending-info { flex: 1; min-width: 0; }
.pending-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  font-size: 0.95rem;
  color: #7b341e;
  margin-bottom: 0.2rem;
}
.pending-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ed8936;
  box-shadow: 0 0 0 4px rgba(237, 137, 54, 0.18);
  animation: pending-pulse 2s ease-in-out infinite;
}
@keyframes pending-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.55; }
}
.pending-detail {
  font-size: 0.85rem;
  color: #744210;
  line-height: 1.5;
}
.pending-btn {
  flex-shrink: 0;
}

.explainer h2 {
  /* Match the existing form-section heading scale; the explainer just
     happens to host long-form content. */
}
.explainer-list {
  margin: 0;
  padding-left: 1.25rem;
  font-size: 0.875rem;
  color: #2d3748;
  line-height: 1.6;
}
.explainer-list li { margin-bottom: 0.55rem; }
.explainer-list li:last-child { margin-bottom: 0; }
.explainer-list code {
  background: #edf2f7;
  padding: 0.1em 0.35em;
  border-radius: 3px;
  font-family: ui-monospace, monospace;
  font-size: 0.85em;
  color: #4a5568;
}
.explainer-list em {
  color: #4c51bf;
  font-style: normal;
  font-weight: 500;
}
.explainer-foot {
  margin-top: 1rem;
  margin-bottom: 0;
  padding-top: 0.75rem;
  border-top: 1px solid #f0f4f8;
}

.form-section {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 1.5rem;
  margin-bottom: 1.25rem;
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
  display: block; font-size: 0.875rem; font-weight: 500;
  color: #4a5568; margin-bottom: 0.375rem;
}
label.checkbox { display: flex; align-items: center; gap: 0.5rem; font-weight: 500; }

input[type="text"], input[type="password"] {
  display: block; width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.9rem;
  background: white; outline: none;
}
input:focus {
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102,126,234,0.15);
}

.form-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  justify-content: flex-end;
  padding-top: 0.5rem;
}
.form-actions-row { padding-top: 0; }

.save-status { font-size: 0.875rem; font-weight: 500; }
.save-status.saving { color: #718096; }
.save-status.ok { color: #2f855a; }
.save-status.err { color: #c53030; max-width: 380px; }

.btn-primary {
  padding: 0.6rem 1.25rem;
  background: #667eea; color: white;
  border: none; border-radius: 6px;
  font-size: 0.9rem; font-weight: 500;
  cursor: pointer;
}
.btn-primary:hover:not(:disabled) { background: #5a67d8; }

.btn-secondary {
  padding: 0.6rem 1.25rem;
  background: white; color: #4a5568;
  border: 1px solid #e2e8f0; border-radius: 6px;
  font-size: 0.9rem; cursor: pointer;
}
.btn-secondary:hover:not(:disabled) { background: #f7fafc; }
.btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-rebuild {
  padding: 0.6rem 1.25rem;
  background: #38a169; color: white;
  border: none; border-radius: 6px;
  font-size: 0.9rem; font-weight: 500;
  cursor: pointer;
}
.btn-rebuild:hover:not(:disabled) { background: #2f855a; }
.btn-rebuild:disabled { opacity: 0.5; cursor: not-allowed; }

button:disabled { opacity: 0.6; cursor: not-allowed; }

.success-msg {
  background: #f0fff4; border: 1px solid #9ae6b4;
  color: #276749; padding: 0.875rem 1rem;
  border-radius: 8px; margin-bottom: 1rem; font-size: 0.9rem;
}
.error-msg {
  background: #fff5f5; border: 1px solid #fc8181;
  color: #c53030; padding: 0.875rem 1rem;
  border-radius: 8px; margin-bottom: 1rem; font-size: 0.9rem;
}

@media (max-width: 720px) {
  .container { padding: 1rem 0.75rem; }
  .form-section { padding: 1rem; }
  .form-row { flex-direction: column; gap: 0; }
  /* 16px input font prevents iOS Safari from zooming on focus. */
  input[type="text"],
  input[type="password"] {
    font-size: 16px;
    padding: 0.625rem 0.75rem;
    min-height: 44px;
  }
  /* Pin native checkbox size — balloons at larger label fonts otherwise.
     Inline-block + vertical-align keeps it on the same line as its label. */
  input[type="checkbox"] {
    display: inline-block;
    width: 18px;
    height: 18px;
    margin: 0;
    flex-shrink: 0;
    vertical-align: middle;
  }
  .form-actions {
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .form-actions button { flex: 1 1 auto; min-height: 44px; }
  .pending-banner {
    flex-direction: column;
    align-items: stretch;
    gap: 0.75rem;
  }
  .pending-btn { width: 100%; min-height: 44px; }
}
</style>
