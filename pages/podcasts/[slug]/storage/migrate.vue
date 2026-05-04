<template>
  <div class="admin-page">
    <AdminNav :podcast-slug="podcastSlug" />
    <div class="container">
      <div class="page-header">
        <h1>Migrate Storage</h1>
        <NuxtLink :to="`/podcasts/${podcastSlug}/storage`" class="btn-back">← Back to Storage</NuxtLink>
      </div>

      <p class="intro">
        Copy this podcast's audio and artwork files to a new storage host
        (or a different adapter), then rewrite the URLs Podshelf has stored.
        Source files are <strong>not deleted</strong> — keep them around
        until the new feed is verified, then clean them up manually.
      </p>

      <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

      <!-- Status of most recent migration -->
      <section v-if="migration" class="form-section status-card" :class="`status-${migration.status}`">
        <h2>Current migration</h2>
        <div class="status-grid">
          <div><span class="status-label">Status</span><span class="status-value">{{ statusLabel }}</span></div>
          <div><span class="status-label">Direction</span><span class="status-value">{{ migration.source_adapter }} → {{ migration.target_adapter }}</span></div>
          <div><span class="status-label">Files</span><span class="status-value">{{ migration.files_done }}/{{ migration.files_total || '?' }}<span v-if="migration.files_failed"> ({{ migration.files_failed }} failed)</span></span></div>
          <div><span class="status-label">Bytes</span><span class="status-value">{{ formatSize(migration.bytes_done) }}<span v-if="migration.bytes_total"> / {{ formatSize(migration.bytes_total) }}</span></span></div>
          <div v-if="migration.current_file" class="full-row"><span class="status-label">Current file</span><span class="status-value mono">{{ migration.current_file }}</span></div>
          <div v-if="migration.error_message" class="full-row"><span class="status-label">Error</span><span class="status-value error">{{ migration.error_message }}</span></div>
          <div v-if="migration.started_at" class="full-row"><span class="status-label">Started</span><span class="status-value">{{ formatDate(migration.started_at) }}</span></div>
          <div v-if="migration.finished_at" class="full-row"><span class="status-label">Finished</span><span class="status-value">{{ formatDate(migration.finished_at) }}</span></div>
        </div>
        <div v-if="isActive" class="progress-bar">
          <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
        </div>
        <p v-if="migration.status === 'complete'" class="status-note ok">
          Migration complete. Storage config has been swapped to <code>{{ migration.target_adapter }}</code>.
          Source files are still in their original location — verify the feed loads correctly,
          then clean up the source manually.
        </p>
        <p v-if="migration.status === 'failed'" class="status-note err">
          The migration didn't finish. Storage config was <strong>not</strong> swapped — episodes
          still reference the original URLs. Fix the underlying issue, then start a new migration
          below; already-copied files will be skipped.
        </p>
      </section>

      <!-- Configure & start new migration -->
      <section v-if="!isActive" class="form-section">
        <h2>{{ migration ? 'Start another migration' : 'Configure target storage' }}</h2>

        <div class="form-group">
          <label>Target adapter</label>
          <select v-model="adapter">
            <option value="sftp">SFTP</option>
            <option value="s3">S3 / Backblaze B2 / R2</option>
          </select>
        </div>

        <!-- SFTP form -->
        <div v-if="adapter === 'sftp'" class="adapter-form">
          <div class="form-row">
            <div class="form-group flex-2">
              <label>Host</label>
              <input v-model="sftp.host" type="text" placeholder="ssh.example.com" />
            </div>
            <div class="form-group">
              <label>Port</label>
              <input v-model.number="sftp.port" type="number" min="1" max="65535" placeholder="22" />
            </div>
          </div>
          <div class="form-group">
            <label>Username</label>
            <input v-model="sftp.username" type="text" />
          </div>
          <div class="form-row">
            <label class="radio"><input type="radio" v-model="sftpAuthMode" value="key" /> Private key</label>
            <label class="radio"><input type="radio" v-model="sftpAuthMode" value="password" /> Password</label>
          </div>
          <div v-if="sftpAuthMode === 'key'" class="form-group">
            <label>Private key (paste contents)</label>
            <textarea v-model="sftp.privateKey" rows="6" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"></textarea>
          </div>
          <div v-if="sftpAuthMode === 'key'" class="form-group">
            <label>Passphrase (if key is encrypted)</label>
            <input v-model="sftp.passphrase" type="password" />
          </div>
          <div v-if="sftpAuthMode === 'password'" class="form-group">
            <label>Password</label>
            <input v-model="sftp.password" type="password" />
          </div>
          <div class="form-row">
            <div class="form-group flex-2">
              <label>Audio remote dir</label>
              <input v-model="sftp.remoteDir" type="text" placeholder="/home/user/podcasts/audio" />
            </div>
            <div class="form-group flex-2">
              <label>Audio public URL base</label>
              <input v-model="sftp.publicUrlBase" type="url" placeholder="https://files.example.com/audio" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group flex-2">
              <label>Artwork remote dir <span class="hint inline">(optional)</span></label>
              <input v-model="sftp.artworkRemoteDir" type="text" placeholder="/home/user/podcasts/artwork" />
            </div>
            <div class="form-group flex-2">
              <label>Artwork public URL base <span class="hint inline">(optional)</span></label>
              <input v-model="sftp.artworkPublicUrlBase" type="url" placeholder="https://files.example.com/artwork" />
            </div>
          </div>
        </div>

        <!-- S3 form -->
        <div v-else class="adapter-form">
          <div class="form-row">
            <div class="form-group flex-2">
              <label>Endpoint <span class="hint inline">(blank for AWS)</span></label>
              <input v-model="s3.endpoint" type="url" placeholder="https://s3.us-west-001.backblazeb2.com" />
            </div>
            <div class="form-group">
              <label>Region</label>
              <input v-model="s3.region" type="text" placeholder="us-east-1" />
            </div>
          </div>
          <div class="form-group">
            <label>Bucket name</label>
            <input v-model="s3.bucketName" type="text" />
          </div>
          <div class="form-row">
            <div class="form-group flex-2">
              <label>Access key ID</label>
              <input v-model="s3.accessKeyId" type="text" />
            </div>
            <div class="form-group flex-2">
              <label>Secret access key</label>
              <input v-model="s3.secretAccessKey" type="password" />
            </div>
          </div>
          <div class="form-group">
            <label>Audio public URL base</label>
            <input v-model="s3.publicUrlBase" type="url" placeholder="https://files.example.com" />
          </div>
          <div class="form-row">
            <div class="form-group flex-2">
              <label>Artwork prefix <span class="hint inline">(optional)</span></label>
              <input v-model="s3.artworkPrefix" type="text" placeholder="artwork/" />
            </div>
            <div class="form-group flex-2">
              <label>Artwork public URL base <span class="hint inline">(optional)</span></label>
              <input v-model="s3.artworkPublicUrlBase" type="url" />
            </div>
          </div>
        </div>

        <div class="form-actions">
          <button type="button" class="btn-secondary" :disabled="testing" @click="onTest">
            {{ testing ? 'Testing…' : 'Test target' }}
          </button>
          <button type="button" class="btn-primary" :disabled="starting" @click="onStart">
            {{ starting ? 'Queuing…' : 'Start migration' }}
          </button>
        </div>

        <p v-if="testMsg" class="test-msg" :class="{ ok: testOk, err: !testOk }">{{ testMsg }}</p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const podcastSlug = route.params.slug as string

interface MigrationRow {
  id: number
  podcast_id: number
  status: 'pending' | 'running' | 'complete' | 'failed'
  source_adapter: string
  target_adapter: string
  files_total: number
  files_done: number
  files_failed: number
  bytes_total: number
  bytes_done: number
  current_file: string | null
  error_message: string | null
  started_at: string | null
  finished_at: string | null
}

const migration = ref<MigrationRow | null>(null)
const errorMsg = ref('')
const testing = ref(false)
const starting = ref(false)
const testMsg = ref('')
const testOk = ref(false)

const isActive = computed(() => migration.value?.status === 'pending' || migration.value?.status === 'running')

const statusLabel = computed(() => {
  if (!migration.value) return ''
  switch (migration.value.status) {
    case 'pending': return 'Pending — waiting for worker'
    case 'running': return 'Running'
    case 'complete': return 'Complete'
    case 'failed': return 'Failed'
    default: return migration.value.status
  }
})

const progressPercent = computed(() => {
  if (!migration.value) return 0
  if (migration.value.bytes_total > 0) {
    return Math.round((migration.value.bytes_done / migration.value.bytes_total) * 100)
  }
  if (migration.value.files_total > 0) {
    return Math.round((migration.value.files_done / migration.value.files_total) * 100)
  }
  return 0
})

const adapter = ref<'sftp' | 's3'>('sftp')
const sftpAuthMode = ref<'key' | 'password'>('key')
const sftp = reactive({
  host: '',
  port: 22 as number,
  username: '',
  privateKey: '',
  passphrase: '',
  password: '',
  remoteDir: '',
  publicUrlBase: '',
  artworkRemoteDir: '',
  artworkPublicUrlBase: '',
})
const s3 = reactive({
  endpoint: '',
  region: 'us-east-1',
  accessKeyId: '',
  secretAccessKey: '',
  bucketName: '',
  publicUrlBase: '',
  artworkPrefix: '',
  artworkPublicUrlBase: '',
})

function buildConfig() {
  if (adapter.value === 'sftp') {
    const c: Record<string, unknown> = {
      host: sftp.host.trim(),
      port: sftp.port || 22,
      username: sftp.username.trim(),
      remoteDir: sftp.remoteDir.trim(),
      publicUrlBase: sftp.publicUrlBase.trim(),
    }
    if (sftpAuthMode.value === 'key') {
      if (sftp.privateKey) c.privateKey = sftp.privateKey
      if (sftp.passphrase) c.passphrase = sftp.passphrase
    } else if (sftp.password) {
      c.password = sftp.password
    }
    if (sftp.artworkRemoteDir) c.artworkRemoteDir = sftp.artworkRemoteDir.trim()
    if (sftp.artworkPublicUrlBase) c.artworkPublicUrlBase = sftp.artworkPublicUrlBase.trim()
    return c
  }
  const c: Record<string, unknown> = {
    region: s3.region.trim() || 'us-east-1',
    accessKeyId: s3.accessKeyId.trim(),
    secretAccessKey: s3.secretAccessKey,
    bucketName: s3.bucketName.trim(),
    publicUrlBase: s3.publicUrlBase.trim(),
  }
  if (s3.endpoint) c.endpoint = s3.endpoint.trim()
  if (s3.artworkPrefix) c.artworkPrefix = s3.artworkPrefix.trim()
  if (s3.artworkPublicUrlBase) c.artworkPublicUrlBase = s3.artworkPublicUrlBase.trim()
  return c
}

async function refreshMigration() {
  try {
    migration.value = await $fetch<MigrationRow | null>(`/api/podcasts/${podcastSlug}/storage/migrate`)
  } catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : 'Failed to load migration status'
  }
}
await refreshMigration()

let pollHandle: ReturnType<typeof setInterval> | null = null
function startPolling() {
  if (pollHandle) return
  pollHandle = setInterval(() => {
    refreshMigration()
    if (!isActive.value && pollHandle) {
      clearInterval(pollHandle)
      pollHandle = null
    }
  }, 2000)
}
if (isActive.value) startPolling()
onBeforeUnmount(() => { if (pollHandle) clearInterval(pollHandle) })

async function onTest() {
  testing.value = true
  testMsg.value = ''
  try {
    await $fetch(`/api/podcasts/${podcastSlug}/storage/test`, {
      method: 'POST',
      body: { adapter: adapter.value, config: buildConfig(), kind: 'audio' },
    })
    testMsg.value = 'Target connection succeeded.'
    testOk.value = true
  } catch (err: unknown) {
    testMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
        || (err instanceof Error ? err.message : 'Test failed')
    testOk.value = false
  } finally {
    testing.value = false
  }
}

async function onStart() {
  if (!window.confirm('Start the migration? Files will be copied (not moved) from the current storage to the target. The active storage config will be swapped only after every file copies successfully.')) return
  starting.value = true
  errorMsg.value = ''
  try {
    const row = await $fetch<MigrationRow>(`/api/podcasts/${podcastSlug}/storage/migrate`, {
      method: 'POST',
      body: { adapter: adapter.value, config: buildConfig() },
    })
    migration.value = row
    startPolling()
  } catch (err: unknown) {
    errorMsg.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
        || (err instanceof Error ? err.message : 'Failed to start migration')
  } finally {
    starting.value = false
  }
}

function formatSize(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

function formatDate(iso: string): string {
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z')
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

useHead({ title: 'Migrate Storage — Podshelf Admin' })
</script>

<style scoped>
* { box-sizing: border-box; }
.admin-page { min-height: 100vh; background: #f7fafc; font-family: system-ui, sans-serif; }
.container { max-width: 760px; margin: 0 auto; padding: 2rem 1.25rem; }

.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
h1 { margin: 0; font-size: 1.5rem; color: #1a202c; }
.btn-back { font-size: 0.875rem; color: #667eea; text-decoration: none; }
.btn-back:hover { text-decoration: underline; }

.intro { color: #4a5568; font-size: 0.92rem; line-height: 1.55; margin: 0 0 1.25rem; }

.form-section {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 1.5rem;
  margin-bottom: 1.25rem;
}
.form-section h2 {
  margin: 0 0 1rem;
  font-size: 0.95rem;
  font-weight: 600;
  color: #4a5568;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.status-card.status-running { border-color: #c3dafe; background: #ebf4ff; }
.status-card.status-complete { border-color: #9ae6b4; background: #f0fff4; }
.status-card.status-failed { border-color: #fc8181; background: #fff5f5; }
.status-card.status-pending { border-color: #faf089; background: #fffff0; }

.status-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem 1rem;
  margin-bottom: 0.75rem;
}
.status-grid > div { display: flex; flex-direction: column; gap: 0.1rem; }
.status-grid .full-row { grid-column: 1 / -1; }
.status-label {
  font-size: 0.7rem;
  font-weight: 600;
  color: #718096;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.status-value { font-size: 0.92rem; color: #2d3748; }
.status-value.mono { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 0.82rem; word-break: break-all; }
.status-value.error { color: #c53030; }

.progress-bar {
  background: rgba(0,0,0,0.08);
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 0.75rem;
}
.progress-fill {
  background: #4c51bf;
  height: 100%;
  transition: width 0.3s ease;
}

.status-note {
  font-size: 0.85rem;
  margin: 0;
  padding: 0.6rem 0.75rem;
  border-radius: 6px;
  line-height: 1.5;
}
.status-note.ok { background: #c6f6d5; color: #22543d; }
.status-note.err { background: #fed7d7; color: #742a2a; }
.status-note code { background: rgba(0,0,0,0.08); padding: 0.05em 0.3em; border-radius: 3px; }

.form-group { margin-bottom: 1rem; }
.form-row { display: flex; gap: 1rem; }
.form-row .form-group { flex: 1; }
.form-row .form-group.flex-2 { flex: 2; }
label { display: block; font-size: 0.875rem; font-weight: 500; color: #4a5568; margin-bottom: 0.375rem; }
.hint.inline { font-weight: 400; color: #a0aec0; font-size: 0.78rem; margin-left: 0.25rem; }

input[type="text"],
input[type="url"],
input[type="password"],
input[type="number"],
select,
textarea {
  display: block; width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid #e2e8f0; border-radius: 6px;
  font-size: 0.9rem;
  background: white; color: #2d3748; outline: none;
  font-family: inherit;
}
input:focus, select:focus, textarea:focus {
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102,126,234,0.15);
}
textarea { resize: vertical; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 0.82rem; }

.radio { display: inline-flex; align-items: center; gap: 0.4rem; margin-right: 1rem; font-weight: 400; }

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.75rem;
}
.btn-primary {
  padding: 0.55rem 1.1rem;
  background: #667eea; color: white;
  border: none; border-radius: 6px;
  font-size: 0.9rem; font-weight: 500;
  cursor: pointer;
}
.btn-primary:hover:not(:disabled) { background: #5a67d8; }
.btn-primary:disabled, .btn-secondary:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-secondary {
  padding: 0.5rem 1rem;
  background: white; color: #4a5568;
  border: 1px solid #e2e8f0; border-radius: 6px;
  font-size: 0.9rem; cursor: pointer; text-decoration: none;
}
.btn-secondary:hover:not(:disabled) { background: #f7fafc; }

.test-msg {
  margin-top: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 5px;
  font-size: 0.85rem;
}
.test-msg.ok { background: #f0fff4; border: 1px solid #9ae6b4; color: #276749; }
.test-msg.err { background: #fff5f5; border: 1px solid #fc8181; color: #c53030; }

.error-msg {
  background: #fff5f5; border: 1px solid #fc8181;
  color: #c53030; padding: 0.875rem 1rem;
  border-radius: 8px; margin-bottom: 1rem; font-size: 0.9rem;
}

@media (max-width: 600px) {
  .form-row { flex-direction: column; gap: 0.5rem; }
  .status-grid { grid-template-columns: 1fr; }
}
</style>
