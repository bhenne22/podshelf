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

      <p v-if="current?.configured" class="status">
        <strong>Configured.</strong> Auto-trigger is
        <strong>{{ form.auto_trigger ? 'on' : 'off' }}</strong>.
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
            Needs <code>contents: read</code> + <code>actions: write</code> on the target repo
            (fine-grained), or classic token with <code>repo</code> scope. Stored encrypted.
          </p>
        </div>

        <div class="form-group">
          <label class="checkbox">
            <input v-model="form.auto_trigger" type="checkbox" />
            Auto-trigger on feed changes
          </label>
          <p class="hint">
            Fires when an episode's published state or metadata changes, when a published
            episode is deleted, or when feed-visible podcast settings change. Off by
            default — flip on once you've verified manual rebuild works.
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
        </p>
        <div class="form-actions form-actions-row">
          <span v-if="triggering" class="save-status saving">Triggering…</span>
          <span v-else-if="lastTriggerOk" class="save-status ok">✓ Sent ({{ lastTriggerOk }})</span>
          <button class="btn-rebuild" :disabled="triggering || !current?.configured" @click="manualTrigger">
            {{ triggering ? 'Triggering…' : 'Rebuild Now' }}
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

interface GitHubDescription {
  configured: boolean
  owner: string | null
  repo: string | null
  event_type: string | null
  has_token: boolean
  auto_trigger: boolean
}

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
}
</style>
